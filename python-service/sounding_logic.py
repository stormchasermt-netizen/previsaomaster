import pandas as pd
import numpy as np
import io
import sharppy.sharptab.profile as profile
import sharppy.sharptab.params as params
import sharppy.sharptab.thermo as thermo

def process_csv_content(csv_text: str):
    """
    Parses a CSV string, creates a SHARPpy profile, and extracts Southern Hemisphere indices.
    Returns a dict with `profile` (for SkewT) and `indices` (for stats/boxplots).
    """
    lines = csv_text.strip().split('\n')
    
    # Try to find header line index
    header_idx = -1
    for i, line in enumerate(lines[:20]):
        if 'height' in line.lower() or 'hght' in line.lower():
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
        
    # Normalize columns to lowercase
    df.columns = [c.strip().lower() for c in df.columns]
    
    # Required columns mapping
    # Hght, Pres, Temp, Dwpt, Wdir, Wspd
    col_map = {
        'height': ['height', 'hght', 'z'],
        'pres': ['pres', 'pressure', 'p'],
        'temp': ['temp', 't', 'temperature'],
        'dwpt': ['dwpt', 'td', 'dewpoint'],
        'wdir': ['dir', 'wdir', 'drct', 'wd'],
        'wspd': ['speed', 'wspd', 'sknt', 'ws']
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
    
    # Needs to be flipped so highest pressure is first
    if p[0] < p[-1]:
        p = p[::-1]; z = z[::-1]; t = t[::-1]; td = td[::-1]; wd = wd[::-1]; ws = ws[::-1]
    
    prof = profile.create_profile(profile='convective', pres=p, hght=z, tmpc=t, dwpc=td, wdir=wd, wspd=ws, missing=-9999)
    
    # Calculate Indices
    ml_pcl = params.parcelx(prof, flag=4) # Mixed Layer
    
    mlcape = ml_pcl.bplus
    mllcl = ml_pcl.lclhght
    cape03ml = ml_pcl.b3km
    
    # Effective Shear
    eff_shear = params.effective_shear(prof, ml_pcl)
    eff_shear_mag = eff_shear[0] if eff_shear[0] != prof.missing else 0
    
    # Bunkers Storm Motion (Left Mover for Southern Hemisphere!)
    srwind = params.bunkers_storm_motion(prof)
    if srwind:
        lm_u, lm_v = srwind[2], srwind[3] # Left Mover (u, v)
    else:
        lm_u, lm_v = 0, 0
        
    # Storm Relative Helicity using Left Mover
    srh1km = params.helicity(prof, 0, 1000, stu=lm_u, stv=lm_v)
    srh3km = params.helicity(prof, 0, 3000, stu=lm_u, stv=lm_v)
    srh1km_val = srh1km[0] if srh1km[0] != prof.missing else 0
    srh3km_val = srh3km[0] if srh3km[0] != prof.missing else 0
    
    # Low level shear
    shr0_500m = params.wind_shear(prof, pbot=prof.pres[prof.sfc], ptop=interp_p(prof, 500))
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
    srh500m = params.helicity(prof, 0, 500, stu=lm_u, stv=lm_v)
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

    return {
        "profile": profile_data,
        "parcel": parcel_data,
        "indices": indices
    }

def interp_p(prof, hght_agl):
    """ Helper to interpolate pressure at a given AGL height """
    return thermo.ctk(thermo.interp(hght_agl + prof.hght[prof.sfc], prof.hght, prof.pres))
