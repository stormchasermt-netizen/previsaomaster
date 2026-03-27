import pandas as pd
import numpy as np
import io
import datetime
import tempfile
import subprocess
import base64
import os
from PIL import Image
import sharppy.sharptab.profile as profile
import sharppy.sharptab.params as params
import sharppy.sharptab.winds as winds
import sharppy.sharptab.thermo as thermo

def process_csv_content(csv_text: str, generate_image: bool = False, image_title: str = "Tornado Track Sounding"):
    """
    Parses a CSV string, creates a SHARPpy profile, and extracts Southern Hemisphere indices.
    If generate_image is True, calls Rscript thundeR to output a professional Skew-T.
    Returns a dict with `profile`, `parcel`, `indices`, and `base64_img`.
    """
    lines = csv_text.strip().split('\n')
    
    # Try to find header line index
    header_idx = -1
    for i, line in enumerate(lines[:20]):
        l = line.lower()
        if 'height' in l or 'hght' in l or 'altitude' in l:
            header_idx = i
            break
            
    if header_idx == -1:
        # Fallback to 0 if no clear header
        header_idx = 0
        
    # Read CSV
    try:
        df = pd.read_csv(io.StringIO("\n".join(lines[header_idx:])), sep=None, engine='python')
    except Exception as e:
        raise ValueError(f"Failed to parse CSV: {str(e)}")
        
    # Normalize columns to lowercase and remove quotes just in case
    df.columns = [str(c).strip().lower().replace('"', '').replace("'", "") for c in df.columns]
    
    # Required columns mapping
    # Hght, Pres, Temp, Dwpt, Wdir, Wspd
    col_map = {
        'height': ['height', 'hght', 'z', 'altitude'],
        'pres': ['pres', 'pressure', 'p'],
        'temp': ['temp', 't', 'temperature'],
        'dwpt': ['dwpt', 'td', 'dewpoint', 'dew_point'],
        'wdir': ['dir', 'wdir', 'drct', 'wd', 'wind_direction'],
        'wspd': ['speed', 'wspd', 'sknt', 'ws', 'wind_speed']
    }
    
    found_cols = {}
    for key, candidates in col_map.items():
        for cand in candidates:
            if cand in df.columns:
                found_cols[key] = cand
                break
                
    # If missing crucial thermo data, we cannot do SHARPpy easily, but we'll try
    if 'pres' not in found_cols or 'temp' not in found_cols or 'dwpt' not in found_cols:
        raise ValueError("CSV is missing PRES, TEMP, or DWPT required for thermodynamic calculations.")
        
    hght = df[found_cols.get('height')].values
    pres = df[found_cols['pres']].values
    temp = df[found_cols['temp']].values
    dwpt = df[found_cols['dwpt']].values
    wdir = df[found_cols.get('wdir')].values if 'wdir' in found_cols else np.zeros_like(hght)
    wspd = df[found_cols.get('wspd')].values if 'wspd' in found_cols else np.zeros_like(hght)
    
    # Convert Agl if hght doesn't start at 0
    # SHARPpy expects hght in meters MSL, but it asks for surface elevation in Profile creation.
    # If hght starts at 0, it is AGL. We just set it as is.
    
    # Clean NaNs and invalid data
    valid_mask = ~np.isnan(pres) & ~np.isnan(temp) & ~np.isnan(dwpt) & ~np.isnan(wdir) & ~np.isnan(wspd)
    
    p = pres[valid_mask]
    z = hght[valid_mask]
    t = temp[valid_mask]
    td = dwpt[valid_mask]
    wd = wdir[valid_mask]
    ws = wspd[valid_mask]
    
    if len(p) < 5:
        raise ValueError("Insufficient valid data points in CSV (less than 5 levels).")

    # Needs to be flipped so highest pressure is first
    if p[0] < p[-1]:
        p = p[::-1]; z = z[::-1]; t = t[::-1]; td = td[::-1]; wd = wd[::-1]; ws = ws[::-1]
    
    # Fix: Provide a dummy date to avoid 'NoneType' strftime errors in SHARPpy
    prof = profile.create_profile(profile='convective', pres=p, hght=z, tmpc=t, dwpc=td, wdir=wd, wspd=ws, missing=-9999, date=datetime.datetime.now())
    
    # Calculate Indices
    ml_pcl = params.parcelx(prof, flag=4) # Mixed Layer
    
    mlcape = ml_pcl.bplus
    mllcl = ml_pcl.lclhght
    cape03ml = ml_pcl.b3km
    
    # Effective Shear (Bulk shear from effective inflow base to ~50% EL)
    # Fallback to 0-6km shear if not available
    eff_inflow = params.effective_inflow_layer(prof, 100, -250)
    eff_shear_mag = 0
    if eff_inflow and eff_inflow[0] != prof.missing and eff_inflow[1] != prof.missing:
        ebot = eff_inflow[0]
        el_p = ml_pcl.elhght
        try:
            el_agl = np.interp(el_p, prof.pres[::-1], prof.hght[::-1]) - prof.hght[prof.sfc]
            etop_hght = el_agl * 0.5 + prof.hght[prof.sfc]
            etop = np.interp(etop_hght, prof.hght, prof.pres)
            eff_shear = winds.wind_shear(prof, pbot=ebot, ptop=etop)
            if eff_shear and eff_shear[0] != prof.missing:
                eff_shear_mag = np.sqrt(eff_shear[0]**2 + eff_shear[1]**2)
        except Exception:
            pass
            
    if eff_shear_mag == 0:
        # Fallback to 0-6km shear
        p6km = np.interp(prof.hght[prof.sfc] + 6000, prof.hght, prof.pres)
        s6km = winds.wind_shear(prof, pbot=prof.pres[prof.sfc], ptop=p6km)
        if s6km and s6km[0] != prof.missing:
            eff_shear_mag = np.sqrt(s6km[0]**2 + s6km[1]**2)
    
    # Bunkers Storm Motion (Left Mover for Southern Hemisphere!)
    srwind = params.bunkers_storm_motion(prof)
    if srwind:
        lm_u, lm_v = srwind[2], srwind[3] # Left Mover (u, v)
    else:
        lm_u, lm_v = 0, 0
        
    # Storm Relative Helicity using Left Mover
    srh1km = winds.helicity(prof, 0, 1000, stu=lm_u, stv=lm_v)
    srh3km = winds.helicity(prof, 0, 3000, stu=lm_u, stv=lm_v)
    srh1km_val = srh1km[0] if srh1km[0] != prof.missing else 0
    srh3km_val = srh3km[0] if srh3km[0] != prof.missing else 0
    
    # Low level shear
    shr0_500m = winds.wind_shear(prof, pbot=prof.pres[prof.sfc], ptop=interp_p(prof, 500))
    shr0_500m_mag = np.sqrt(shr0_500m[0]**2 + shr0_500m[1]**2) if shr0_500m[0] != prof.missing else 0
    
    # Significant Tornado Parameter (STP) [LEFT MOVER]
    # Fixed formula for LM: using LM SRH and taking absolute values since LM SRH is often negative in SH.
    # STP = (mlCAPE/1500) * ((2000-mlLCL)/1000) * (abs(srh1km)/150) * (EShear/20)
    def calc_stp(cape, lcl, srh, shear):
        c_term = cape / 1500.0
        l_term = (2000.0 - lcl) / 1000.0
        l_term = max(0.0, min(1.0, l_term))
        s_term = abs(srh) / 150.0
        sh_term = shear / 20.0
        sh_term = max(0.0, min(1.5, sh_term))
        return c_term * l_term * s_term * sh_term

    # Approximate 0-500m STP using 500m shear and pseudo srh
    srh500m = winds.helicity(prof, 0, 500, stu=lm_u, stv=lm_v)
    srh500m_val = srh500m[0] if srh500m[0] != prof.missing else 0
    
    stp0_1km = calc_stp(mlcape, mllcl, srh1km_val, eff_shear_mag)
    stp0_500m = calc_stp(mlcape, mllcl, srh500m_val, shr0_500m_mag)

    # Convert parcel path for rendering
    parcel_temp = ml_pcl.ttrace
    parcel_pres = ml_pcl.ptrace

    # Pack profile data for frontend drawing (SkewT limits usually 1000 to 100hPa)
    profile_data = []
    for i in range(len(p)):
        u, v = prof.u[i], prof.v[i]
        profile_data.append({
            "pressure": float(p[i]),
            "height": float(z[i]),
            "temp": float(t[i]),
            "dwpt": float(td[i]),
            "u": float(u) if u != prof.missing else None,
            "v": float(v) if v != prof.missing else None
        })
        
    parcel_data = [{"pressure": float(p_), "temp": float(t_)} for p_, t_ in zip(parcel_pres, parcel_temp)]

    indices = {
        "mlCAPE": float(mlcape),
        "mlLCL": float(mllcl),
        "CAPE03ml": float(cape03ml),
        "EFFshear": float(eff_shear_mag),
        "Shr_0_500m": float(shr0_500m_mag),
        "srh_0_1km": float(srh1km_val),
        "srh_0_3km": float(srh3km_val),
        "STP_0_1km": float(stp0_1km),
        "STP_0_500m": float(stp0_500m)
    }

    base64_img = None
    if generate_image:
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                csv_path = os.path.join(tmpdir, "sounding.csv")
                png_path = os.path.join(tmpdir, "plot.png")
                # Write standard CSV for R
                df_out = pd.DataFrame({
                    "pres": p,
                    "hght": z,
                    "tmpc": t,
                    "dwpc": td,
                    "wdir": wd,
                    "wspd": ws
                })
                df_out.to_csv(csv_path, index=False)
                
                # Run R script
                cmd = ["Rscript", "plot_skewt.R", csv_path, png_path, image_title]
                subprocess.run(cmd, check=True, capture_output=True)
                
                if os.path.exists(png_path):
                    with Image.open(png_path) as img:
                        # Crop the bottom 45 pixels to remove generic watermarks and keep it white-label
                        w, h = img.size
                        cropped = img.crop((0, 0, w, h - 45))
                        
                        buffered = io.BytesIO()
                        cropped.save(buffered, format="PNG", optimize=True)
                        base64_img = "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode("utf-8")
        except Exception as e:
            print(f"Failed to generate R Skew-T image: {e}")

    return {
        "profile": profile_data,
        "parcel": parcel_data,
        "indices": indices,
        "base64_img": base64_img
    }

def interp_p(prof, hght_agl):
    """ Helper to interpolate pressure at a given AGL height """
    target_hght = hght_agl + prof.hght[prof.sfc]
    return np.interp(target_hght, prof.hght, prof.pres)
