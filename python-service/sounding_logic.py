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

            # --- ULTIMATE SPC PROFESSIONAL LAYOUT ---
            import matplotlib.gridspec as gridspec
            
            # Theme Setup (Black / SPC Style)
            plt.rcParams['figure.facecolor'] = 'black'
            plt.rcParams['axes.facecolor'] = 'black'
            plt.rcParams['text.color'] = 'white'
            plt.rcParams['axes.labelcolor'] = 'white'
            plt.rcParams['xtick.color'] = 'white'
            plt.rcParams['ytick.color'] = 'white'
            plt.rcParams['font.size'] = 10

            fig = plt.figure(figsize=(20, 14), facecolor='black')
            
            # 1. Grade Mestre: Divide a tela horizontalmente (Gráficos vs Tabelas)
            gs_master = fig.add_gridspec(2, 1, height_ratios=[3, 1.1], hspace=0.1)

            # ==========================================
            # PARTE SUPERIOR (GRÁFICOS)
            # ==========================================
            # Divide a parte superior em 4 colunas
            gs_top = gs_master[0].subgridspec(1, 4, width_ratios=[12, 1.2, 1.2, 7.5], wspace=0.1)

            # --- A. SKEW-T (Gigante na esquerda) ---
            ax_skewt_master = fig.add_subplot(gs_top[0])
            skew = SkewT(fig, rotation=45, subplot=ax_skewt_master)
            
            p_units = p * units.hPa
            t_units = t * units.degC
            td_units = td * units.degC
            u_arr = np.array([u_ if u_ != prof.missing else np.nan for u_ in prof.u]) * units.knots
            v_arr = np.array([v_ if v_ != prof.missing else np.nan for v_ in prof.v]) * units.knots
            
            skew.plot(p_units, t_units, 'red', linewidth=3)
            skew.plot(p_units, td_units, 'green', linewidth=3)
            
            # Wind Barbs (SH Convention: Flip barbs)
            idx = np.arange(0, len(p_units), max(1, len(p_units)//30))
            skew.plot_barbs(p_units[idx], u_arr[idx], v_arr[idx], 
                            flip_barbs=True, color='white', linewidth=0.8, length=6)
            
            skew.plot(mu_pcl.ptrace * units.hPa, mu_pcl.ttrace * units.degC, 'white', linestyle='--', linewidth=1.5)
            
            # Background Lines
            skew.plot_dry_adiabats(color='grey', alpha=0.3, linewidth=0.5)
            skew.plot_moist_adiabats(color='grey', alpha=0.3, linewidth=0.5)
            skew.plot_mixing_lines(color='grey', alpha=0.3, linewidth=0.5)
            
            skew.ax.set_ylim(1050, 100)
            skew.ax.set_xlim(-40, 45)
            skew.ax.set_ylabel('Pressao (hPa)')
            skew.ax.set_xlabel('Temperatura (C)')
            skew.ax.set_title(f"PREVISAO MASTER - {image_title}", loc='left', fontsize=18, fontweight='bold', color='yellow')

            # --- B. PERFIL DE VENTOS (Visual Placeholder) ---
            ax_wind_prof = fig.add_subplot(gs_top[1])
            ax_wind_prof.axis('off')
            # Text placeholder like GUI
            ax_wind_prof.text(0.5, 0.9, "Wind\nSpeed\n(kt)", color='cyan', ha='center', va='top', fontsize=9)

            # --- C. ADVECÇÃO DE TEMP (Visual Placeholder) ---
            ax_temp_adv = fig.add_subplot(gs_top[2])
            ax_temp_adv.axis('off')
            ax_temp_adv.text(0.5, 0.9, "Inferred\nTemp\nAdv", color='white', ha='center', va='top', fontsize=9)

            # --- D. LADO DIREITO (Hodógrafo + Sub-gráficos) ---
            gs_top_right = gs_top[3].subgridspec(2, 1, height_ratios=[2.5, 1], hspace=0.1)

            # 3A: Hodógrafo (No topo à direita)
            ax_hodo = fig.add_subplot(gs_top_right[0])
            ax_hodo.set_facecolor('black')
            h = Hodograph(ax_hodo, component_range=80.)
            h.add_grid(increment=20, color='white', alpha=0.3)
            
            z_mask = ~np.isnan(u_arr.magnitude) & ~np.isnan(v_arr.magnitude) & (z <= 12000)
            if np.any(z_mask):
                h.plot_colormapped(u_arr[z_mask], v_arr[z_mask], z[z_mask], cmap='rainbow')
            
            # Plot Storm Motion (Left Mover Circle)
            ax_hodo.plot(lm_u, lm_v, 'ko', markersize=10, markerfacecolor='none', markeredgewidth=2, markeredgecolor='white')
            ax_hodo.text(lm_u, lm_v+2, 'LM', color='red', fontsize=10, ha='center', fontweight='bold')
            ax_hodo.set_title("Hodografo (nos) - ate 12km AGL", color='white', fontsize=12, fontweight='bold')
            
            # Altitude Labels
            for h_km in [0, 1, 3, 6, 9]:
                idx_h = np.argmin(np.abs(z - h_km*1000))
                if idx_h < len(u_arr) and not np.isnan(u_arr[idx_h]):
                    ax_hodo.text(u_arr[idx_h].magnitude, v_arr[idx_h].magnitude, f" {h_km}", 
                                color='white', fontsize=11, fontweight='bold')

            # 3B: Gráficos menores 
            ax_minigraphs = fig.add_subplot(gs_top_right[1])
            ax_minigraphs.axis('off')
            ax_minigraphs.text(0.5, 0.5, "Theta-E / SR Winds\n@previsaomaster.com", color='grey', ha='center', va='center', alpha=0.5)

            # ==========================================
            # PARTE INFERIOR (TABELAS DE PARÂMETROS)
            # ==========================================
            gs_bottom = gs_master[1].subgridspec(1, 5, width_ratios=[3.5, 2.5, 1.5, 1.5, 3], wspace=0.05)

            # FORMATO AX.TEXT MONOESPAÇADO (O "MACETE")
            
            # --- Caixa 1: Termodinâmica (Parcelas) ---
            ax_thermo = fig.add_subplot(gs_bottom[0])
            ax_thermo.axis('on'); ax_thermo.set_xticks([]); ax_thermo.set_yticks([])
            for spine in ax_thermo.spines.values(): spine.set_edgecolor('grey')
            
            thermo_txt = (
                f"PARCEL     CAPE   CINH   LCL   LFC    EL\n"
                f"-----------------------------------------\n"
                f"SB (Sfc)   {int(sfc_pcl.bplus):<5}  {int(sfc_pcl.bminus):<5}  {int(sfc_pcl.lclhght):<4}  {int(sfc_pcl.lfchght):<5}  {int(sfc_pcl.elhght):<5}\n"
                f"ML (100)   {int(ml_pcl.bplus):<5}  {int(ml_pcl.bminus):<5}  {int(ml_pcl.lclhght):<4}  {int(ml_pcl.lfchght):<5}  {int(ml_pcl.elhght):<5}\n"
                f"MU (MU )   {int(mu_pcl.bplus):<5}  {int(mu_pcl.bminus):<5}  {int(mu_pcl.lclhght):<4}  {int(mu_pcl.lfchght):<5}  {int(mu_pcl.elhght):<5}\n"
                f"-----------------------------------------\n"
                f"3km MLCAPE: {int(ml_pcl.b3km)} J/kg"
            )
            ax_thermo.text(0.05, 0.9, thermo_txt, color='white', fontsize=10, va='top', family='monospace')

            # --- Caixa 2: Cinemática ---
            ax_kinematics = fig.add_subplot(gs_bottom[1])
            ax_kinematics.axis('on'); ax_kinematics.set_xticks([]); ax_kinematics.set_yticks([])
            for spine in ax_kinematics.spines.values(): spine.set_edgecolor('grey')
            
            s6km = winds.wind_shear(prof, pbot=prof.pres[prof.sfc], ptop=interp_p(prof, 6000))
            s6km_mag = np.sqrt(s6km[0]**2 + s6km[1]**2) if s6km[0] != prof.missing else 0
            
            kin_txt = (
                f"--- KINEMATICS ---\n"
                f"0-6km Bulk: {s6km_mag:.1f} kt\n"
                f"Eff. Shear: {eff_shear_mag:.1f} kt\n"
                f"SRH 0-1km : {srh1km_val:.0f} m2/s2\n"
                f"SRH 0-3km : {srh3km_val:.0f} m2/s2\n"
                f"STP (1km) : {stp0_1km:.2f}\n"
                f"STP (500m): {stp0_500m:.2f}"
            )
            ax_kinematics.text(0.05, 0.9, kin_txt, color='cyan', fontsize=10, va='top', family='monospace')

            # --- Caixa 3: Best Guess / Storm Motion ---
            ax_precip = fig.add_subplot(gs_bottom[2])
            ax_precip.axis('on'); ax_precip.set_xticks([]); ax_precip.set_yticks([])
            for spine in ax_precip.spines.values(): spine.set_edgecolor('grey')
            
            storm_txt = (
                f"STORM MOTION\n"
                f"LEFT MOVER\n"
                f"u: {lm_u:.1f} kt\n"
                f"v: {lm_v:.1f} kt\n"
                f"HS-ONLY"
            )
            ax_precip.text(0.5, 0.5, storm_txt, color='yellow', fontsize=9, ha='center', va='center', fontweight='bold')

            # --- Caixa 4: SARS ---
            ax_sars = fig.add_subplot(gs_bottom[3])
            ax_sars.axis('on'); ax_sars.set_xticks([]); ax_sars.set_yticks([])
            for spine in ax_sars.spines.values(): spine.set_edgecolor('grey')
            ax_sars.text(0.5, 0.5, "SARS\nMatches\nN/A", color='grey', ha='center', va='center', fontsize=9)

            # --- Caixa 5: STP Probability (Visual Placeholder) ---
            ax_stp = fig.add_subplot(gs_bottom[4])
            ax_stp.axis('on'); ax_stp.set_xticks([]); ax_stp.set_yticks([])
            for spine in ax_stp.spines.values(): spine.set_edgecolor('grey')
            ax_stp.text(0.5, 0.5, "Significant Tornado\nParameter (HS)\nPROBABILITY BOX", color='lime', ha='center', va='center', fontsize=10, fontweight='bold')

            # 5.1 Final Watermark
            fig.text(0.98, 0.98, '@previsaomaster.com', color='white', fontsize=12, ha='right', va='top', alpha=0.4, fontweight='bold')

            plt.tight_layout()
            
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=150, bbox_inches='tight', facecolor='black')
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
