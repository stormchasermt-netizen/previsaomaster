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
    z_raw = hght[valid_mask]
    t = temp[valid_mask]
    td = dwpt[valid_mask]
    wd = wdir[valid_mask]
    ws = wspd[valid_mask]
    
    # Convert MSL to AGL: first altitude becomes 0
    z = z_raw - z_raw[0]
    
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
    def calc_stp(cape, lcl, srh, shear):
        c_term = cape / 1500.0
        l_term = (2000.0 - lcl) / 1000.0
        l_term = max(0.0, min(1.0, l_term))
        s_term = abs(srh) / 150.0
        sh_term = shear / 20.0
        sh_term = max(0.0, min(1.5, sh_term))
        return c_term * l_term * s_term * sh_term

    # Approximate 0-500m STP logic
    srh500m = winds.helicity(prof, 0, 500, stu=lm_u, stv=lm_v)
    srh500m_val = srh500m[0] if srh500m[0] != prof.missing else 0
    stp0_1km = calc_stp(mlcape, mllcl, srh1km_val, eff_shear_mag)
    stp0_500m = calc_stp(mlcape, mllcl, srh500m_val, shr0_500m_mag)

    # Calculate additional parcel types for the SHARPpy table
    sfc_pcl = params.parcelx(prof, flag=1) # Surface Based
    mu_pcl = params.parcelx(prof, flag=3)  # Most Unstable
    
    # Pack indices for the complete table (FLATTENED to prevent toFixed crash)
    indices = {
        "MU_CAPE": float(mu_pcl.bplus),
        "MU_CIN": float(mu_pcl.bminus),
        "MU_LCL": float(mu_pcl.lclhght),
        "MU_LFC": float(mu_pcl.lfchght),
        "MU_EL": float(mu_pcl.elhght),
        "ML_CAPE": float(ml_pcl.bplus),
        "ML_CIN": float(ml_pcl.bminus),
        "SFC_CAPE": float(sfc_pcl.bplus),
        "SFC_CIN": float(sfc_pcl.bminus),
        "EFF_Shear": float(eff_shear_mag),
        "SRH_1km_LM": float(srh1km_val),
        "SRH_3km_LM": float(srh3km_val),
        "STP_1km": float(stp0_1km),
        "STP_500m": float(stp0_500m)
    }

    # Data for frontend profile plot (compatibility)
    profile_data = []
    for i in range(len(p)):
        u, v = prof.u[i], prof.v[i]
        profile_data.append({
            "pressure": float(p[i]), "height": float(z[i]), "temp": float(t[i]), "dwpt": float(td[i]),
            "u": float(u) if u != prof.missing else None, "v": float(v) if v != prof.missing else None
        })
    parcel_data = [{"pressure": float(p_), "temp": float(t_)} for p_, t_ in zip(mu_pcl.ptrace, mu_pcl.ttrace)]

            # --- SPC PROFESSIONAL LAYOUT ---
            import matplotlib.gridspec as gridspec
            
            # Theme Setup (Light / SPC Style)
            plt.rcParams['figure.facecolor'] = 'white'
            plt.rcParams['axes.facecolor'] = 'white'
            plt.rcParams['text.color'] = 'black'
            plt.rcParams['axes.labelcolor'] = 'black'
            plt.rcParams['xtick.color'] = 'black'
            plt.rcParams['ytick.color'] = 'black'
            plt.rcParams['font.size'] = 10

            fig = plt.figure(figsize=(22, 15))
            gs = gridspec.GridSpec(15, 12, figure=fig, hspace=0.6, wspace=0.4)
            
            # --- 1. SKEW-T (Large Main Panel) ---
            ax_skew_main = fig.add_subplot(gs[0:10, 0:8])
            skew = SkewT(fig, rotation=45, subplot=ax_skew_main)
            
            p_units = p * units.hPa
            t_units = t * units.degC
            td_units = td * units.degC
            u_arr = np.array([u_ if u_ != prof.missing else np.nan for u_ in prof.u]) * units.knots
            v_arr = np.array([v_ if v_ != prof.missing else np.nan for v_ in prof.v]) * units.knots
            
            skew.plot(p_units, t_units, 'red', linewidth=3, label='Temp')
            skew.plot(p_units, td_units, 'green', linewidth=3, label='Dewpt')
            
            # Wind Barbs (SH Convention: Flip barbs)
            idx = np.arange(0, len(p_units), max(1, len(p_units)//30))
            # Use MetPy's native plot_barbs with flip_barbs for the Southern Hemisphere
            skew.plot_barbs(p_units[idx], u_arr[idx], v_arr[idx], 
                            flip_barbs=True, color='black', linewidth=0.8, length=6)
            
            # Parcel Profile (Black Dashed)
            skew.plot(mu_pcl.ptrace * units.hPa, mu_pcl.ttrace * units.degC, 'black', linestyle='--', linewidth=1.5)
            
            # Background Lines
            skew.plot_dry_adiabats(color='tan', alpha=0.3, linewidth=0.5)
            skew.plot_moist_adiabats(color='grey', alpha=0.3, linewidth=0.5)
            skew.plot_mixing_lines(color='grey', alpha=0.3, linewidth=0.5)
            
            skew.ax.set_ylim(1050, 100)
            skew.ax.set_xlim(-50, 45)
            skew.ax.set_ylabel('Pressao (hPa)')
            skew.ax.set_xlabel('Temperatura (C)')
            skew.ax.set_title(f"PREVISAO MASTER - {image_title}", loc='left', fontsize=18, fontweight='bold', color='darkblue')

            # --- 2. HODOGRAPH (Top Right) ---
            ax_hodo = fig.add_subplot(gs[0:5, 8:12])
            ax_hodo.set_facecolor('#fdfdfd')
            h = Hodograph(ax_hodo, component_range=80.)
            h.add_grid(increment=20, color='grey', alpha=0.3)
            
            # Mask data to 12km for the hodograph
            z_mask = ~np.isnan(u_arr.magnitude) & ~np.isnan(v_arr.magnitude) & (z <= 12000)
            if np.any(z_mask):
                h.plot_colormapped(u_arr[z_mask], v_arr[z_mask], z[z_mask], cmap='rainbow')
            
            # Plot Storm Motion (Left Mover)
            ax_hodo.plot(lm_u, lm_v, 'ko', markersize=10, markerfacecolor='white', markeredgewidth=2)
            ax_hodo.text(lm_u, lm_v+2, 'LM', color='red', fontsize=12, ha='center', fontweight='bold')
            ax_hodo.set_title("Hodografo (nos) - ate 12km AGL", color='black', fontsize=14, fontweight='bold')
            
            # Altitude Labels (0, 1, 3, 6, 9 km)
            for h_km in [0, 1, 3, 6, 9]:
                idx_h = np.argmin(np.abs(z - h_km*1000))
                if idx_h < len(u_arr) and not np.isnan(u_arr[idx_h]):
                    ax_hodo.text(u_arr[idx_h].magnitude, v_arr[idx_h].magnitude, f" {h_km}", 
                                color='black', fontsize=12, fontweight='bold', clip_on=True)

            # --- 3. PARCEL DATA TABLE (Bottom Left) ---
            ax_table_parcel = fig.add_subplot(gs[10:14, 0:4])
            ax_table_parcel.axis('off')
            parcel_rows = [
                ["PARCEL", "CAPE", "CINH", "LCL", "LFC", "EL"],
                ["SB (Surface)", f"{int(sfc_pcl.bplus)}", f"{int(sfc_pcl.bminus)}", f"{int(sfc_pcl.lclhght)}", f"{int(sfc_pcl.lfchght)}", f"{int(sfc_pcl.elhght)}"],
                ["ML (100mb)", f"{int(ml_pcl.bplus)}", f"{int(ml_pcl.bminus)}", f"{int(ml_pcl.lclhght)}", f"{int(ml_pcl.lfchght)}", f"{int(ml_pcl.elhght)}"],
                ["MU (Highest)", f"{int(mu_pcl.bplus)}", f"{int(mu_pcl.bminus)}", f"{int(mu_pcl.lclhght)}", f"{int(mu_pcl.lfchght)}", f"{int(mu_pcl.elhght)}"]
            ]
            tbl_p = ax_table_parcel.table(cellText=parcel_rows, cellLoc='center', loc='center')
            tbl_p.auto_set_font_size(False); tbl_p.set_fontsize(11)
            tbl_p.scale(1.2, 1.8)
            for i in range(len(parcel_rows)):
                for j in range(len(parcel_rows[0])):
                    cell = tbl_p[i, j]
                    if i == 0: cell.set_facecolor('#2c3e50'); cell.set_text_props(color='white', fontweight='bold')
                    else: cell.set_facecolor('#ecf0f1')

            # --- 4. KINEMATICS TABLE (Bottom Middle) ---
            ax_table_kin = fig.add_subplot(gs[10:14, 4:8])
            ax_table_kin.axis('off')
            # Extract some more winds for the table
            s6km = winds.wind_shear(prof, pbot=prof.pres[prof.sfc], ptop=interp_p(prof, 6000))
            s6km_mag = np.sqrt(s6km[0]**2 + s6km[1]**2) if s6km[0] != prof.missing else 0
            
            kin_rows = [
                ["KINEMATIC INDEX", "VALUE", "UNITS"],
                ["Bulk Shear 0-6km", f"{s6km_mag:.1f}", "kt"],
                ["Effective Shear", f"{eff_shear_mag:.1f}", "kt"],
                ["SRH 0-1km (LM)", f"{srh1km_val:.0f}", "m2/s2"],
                ["SRH 0-3km (LM)", f"{srh3km_val:.0f}", "m2/s2"],
                ["STP (0-1km HS)", f"{stp0_1km:.2f}", "index"],
                ["STP (0-500m HS)", f"{stp0_500m:.2f}", "index"]
            ]
            tbl_k = ax_table_kin.table(cellText=kin_rows, cellLoc='center', loc='center')
            tbl_k.auto_set_font_size(False); tbl_k.set_fontsize(11)
            tbl_k.scale(1.2, 1.8)
            for i in range(len(kin_rows)):
                for j in range(len(kin_rows[0])):
                    cell = tbl_k[i, j]
                    if i == 0: cell.set_facecolor('#2c3e50'); cell.set_text_props(color='white', fontweight='bold')
                    else: cell.set_facecolor('#ecf0f1')

            # --- 5. THERMO SUMMARY (Right Side) ---
            ax_thermo = fig.add_subplot(gs[6:10, 8:12])
            ax_thermo.axis('off')
            thermo_text = (
                f"--- CONVECTIVE INDICES ---\n"
                f"SBCAPE: {int(sfc_pcl.bplus)} J/kg\n"
                f"MLCAPE: {int(ml_pcl.bplus)} J/kg\n"
                f"MUCAPE: {int(mu_pcl.bplus)} J/kg\n"
                f"ML CINH: {int(ml_pcl.bminus)} J/kg\n"
                f"ML LCL: {int(ml_pcl.lclhght)} m AGL\n"
                f"ML LFC: {int(ml_pcl.lfchght)} m AGL\n"
                f"ML EL: {int(ml_pcl.elhght)} m AGL\n"
                f"3km MLCAPE: {int(ml_pcl.b3km)} J/kg\n\n"
                f"CALIBRADO PARA HEMISFERIO SUL\n"
                f"Storm Motion: Bunkers LEFT MOVER"
            )
            ax_thermo.text(0, 1, thermo_text, color='darkblue', fontsize=12, va='top', family='monospace', fontweight='bold')

            # 5.1 Watermark (Top Right)
            fig.text(0.96, 0.98, '@previsaomaster.com', color='grey', fontsize=14, ha='right', va='top', alpha=0.5, fontweight='bold')
            
            # Save consolidated image
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=140, bbox_inches='tight', facecolor='white')
            plt.close(fig)
            
            base64_img = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')
            
        except Exception as e:
            print(f"Failed to generate Python Skew-T image: {e}", flush=True)
            base64_img = f"ERROR: {e}"

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
