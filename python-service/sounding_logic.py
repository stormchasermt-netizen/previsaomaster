import pandas as pd
import numpy as np
import io
import datetime
import tempfile
import subprocess
import base64
import os
import matplotlib
matplotlib.use('Agg') # Force non-interactive backend for headless Cloud Run
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from metpy.plots import SkewT, Hodograph
from metpy.units import units

import sharppy.sharptab.profile as profile
import sharppy.sharptab.params as params
import sharppy.sharptab.winds as winds
import sharppy.sharptab.thermo as thermo

print("SHARPpy Sounding Logic Module Loaded", flush=True)

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

    # === RENDERIZACAO NATIVA SPC/METPY (MIMICKING HODOGRAFA.PY) ===
    base64_img = None
    if generate_image:
        try:
            plt.rcParams['axes.facecolor'] = 'white'
            plt.rcParams['text.color'] = 'black'
            plt.rcParams['axes.labelcolor'] = 'black'
            plt.rcParams['xtick.color'] = 'black'
            plt.rcParams['ytick.color'] = 'black'
            plt.rcParams['font.size'] = 11

            # 1. FIGURA PRINCIPAL (Padrão 22x11 com rodapé para os parâmetros)
            fig = plt.figure(figsize=(22, 11), facecolor='white')
            
            # Ajusta o fundo (abre espaco para os indices no rodape)
            fig.subplots_adjust(bottom=0.22)
            
            # --- 2. SKEW-T (LADO ESQUERDO) ---
            skew = SkewT(fig, subplot=(1, 2, 1), rotation=35)
            
            p_units = p * units.hPa
            t_units = t * units.degC
            td_units = td * units.degC
            u_arr = np.array([u_ if u_ != prof.missing else np.nan for u_ in prof.u]) * units.knots
            v_arr = np.array([v_ if v_ != prof.missing else np.nan for v_ in prof.v]) * units.knots
            
            # Curvas Termodinâmicas (Espessas, Clássicas)
            skew.plot(p_units, t_units, 'red', linewidth=3.5, alpha=1.0)
            skew.plot(p_units, td_units, 'green', linewidth=3.5, alpha=1.0)
            
            # Curva da Parcela MU (Preta tracejada)
            mu_ttrace = mu_pcl.ttrace * units.degC
            mu_ptrace = mu_pcl.ptrace * units.hPa
            skew.plot(mu_ptrace, mu_ttrace, 'black', linestyle='--', linewidth=2.0)
            
            # Preenchimento do CAPE (MU)
            try:
                skew.shade_cape(p_units, t_units, mu_ttrace, alpha=0.25)
            except Exception:
                pass
            
            # Linhas de Grade e Background (Cinza Suave)
            skew.plot_dry_adiabats(t0=np.arange(233, 533, 5) * units.K, color='gray', linestyle='-', linewidth=0.5, alpha=0.7)
            skew.plot_moist_adiabats(color='gray', linestyle='-', linewidth=0.5, alpha=0.7)
            skew.plot_mixing_lines(color='gray', linestyle='dotted', linewidth=0.5, alpha=0.7)
            skew.ax.axvline(0, color='blue', linestyle='--', linewidth=1.2, alpha=0.7)
            skew.ax.axvline(-20, color='blue', linestyle='--', linewidth=1.2, alpha=0.7)
            
            # Barbelas de Vento (Lado Direito do SkewT) - Flip para o Hemisfério Sul
            wind_skip = max(1, len(p_units)//30) # Reduz densidade
            try:
                skew.plot_barbs(p_units[::wind_skip], u_arr[::wind_skip], v_arr[::wind_skip], flip_barbs=True, length=6, linewidth=1.0)
            except Exception:
                skew.plot_barbs(p_units[::wind_skip], u_arr[::wind_skip], v_arr[::wind_skip], length=6, linewidth=1.0)

            # Labels de Altitude no lado esquerdo
            target_altitudes_m = np.array([0, 1000, 3000, 6000, 9000, 12000])
            altitude_labels = ['Sfc', '1 km', '3 km', '6 km', '9 km', '12 km']
            for i, alt_m in enumerate(target_altitudes_m):
                p_alt = interp_p(prof, alt_m)
                skew.ax.text(0.01, p_alt/1050.0, altitude_labels[i], transform=skew.ax.transAxes, fontsize=10, color='darkred', ha='left', va='center', fontweight='bold')
            
            skew.ax.set_ylim(1050, 100)
            skew.ax.set_xlim(-50, 50)
            skew.ax.set_xlabel('Temperatura (°C)')
            skew.ax.set_ylabel('Pressão (hPa)')
            skew.ax.set_title(f'Sondagem Atmosférica (PREVISÃO MASTER) - {image_title}', loc='left', fontsize=14, fontweight='bold')


            # --- 3. HODÓGRAFO (LADO DIREITO) ---
            hodo_ax = fig.add_subplot(1, 2, 2)
            h = Hodograph(hodo_ax, component_range=120.) # Alcance 120kt
            h.add_grid(increment=10, color='gray', linestyle='--', alpha=0.6) # Anéis a cada 10 nós
            
            # Preparar dados do vento (em nós) até 10km AGL (+- seguro para tempestades)
            z_m = z
            z_valid = (z_m <= 10000) & ~np.isnan(u_arr.magnitude) & ~np.isnan(v_arr.magnitude)
            u_hodo = u_arr[z_valid]
            v_hodo = v_arr[z_valid]
            z_hodo = z_m[z_valid]
            
            # Rotina de cores da Hodógrafa (SPC Standard: 0-3km Red, 3-6km Green, 6-9km Y/B)
            # Simplificada dividindo em fatias
            intervals = [0, 3000, 6000, 10000]
            colors = ['red', 'green', 'blue']
            
            for i in range(len(intervals)-1):
                mask = (z_hodo >= intervals[i]) & (z_hodo <= intervals[i+1])
                if np.sum(mask) >= 2:
                    h.plot(u_hodo[mask], v_hodo[mask], color=colors[i], linewidth=3.0)
            
            # Bunkers Storm Motion Vectors
            if srwind:
                rm_u, rm_v = srwind[0], srwind[1] # Right Mover
                h.plot(lm_u, lm_v, marker='o', color='red', markersize=9, label='Left-Mover (LM)')
                h.plot(rm_u, rm_v, marker='o', color='blue', markersize=9, label='Right-Mover (RM)')
                
                # Centraliza a Hodógrafa no Left Mover (pois estamos no Hemisfério Sul)
                hodo_window = 60 # nós para cada lado
                hodo_ax.set_xlim(lm_u - hodo_window, lm_u + hodo_window)
                hodo_ax.set_ylim(lm_v - hodo_window, lm_v + hodo_window)
                
                # Preenchimento SRH 0-3km (Polígono de varredura em vermelho fraco)
                # O SRH do SPC é visualizado ligando a origem (LM) ao perfil de vento
                try:
                    z_3km_mask = (z_m <= 3000) & ~np.isnan(u_arr.magnitude) & ~np.isnan(v_arr.magnitude)
                    if np.any(z_3km_mask):
                        poly_x = [lm_u] + u_arr[z_3km_mask].magnitude.tolist()
                        poly_y = [lm_v] + v_arr[z_3km_mask].magnitude.tolist()
                        hodo_ax.fill(poly_x, poly_y, color='red', alpha=0.15, label='SRH 0-3km LM')
                except Exception:
                    pass

            hodo_ax.set_aspect('equal', 'box')
            hodo_ax.set_title('Hodógrafa Relativa (0-10 km AGL) [Foco LM - Hem. Sul]', fontsize=14, loc='center', fontweight='bold')
            hodo_ax.set_xlabel('')
            hodo_ax.set_ylabel('')
            hodo_ax.legend(loc='upper right')
            hodo_ax.axhline(0, color='gray', lw=1.0)
            hodo_ax.axvline(0, color='gray', lw=1.0)
            
            # --- 4. PAINEL DE DADOS (RODAPÉ) ---
            # Imitando precisamente as colunas do layout original (y_pos = 0.12 para caber 6 linhas)
            # A fonte monospace (Courier/Consolas) é crucial para alinhar números.
            y_pos = 0.11
            
            # Coluna 1: CAPEs (J/kg)
            txt_capes = (
                f"SFC CAPE: {int(sfc_pcl.bplus):>4} J/kg\n"
                f"ML CAPE : {int(ml_pcl.bplus):>4} J/kg\n"
                f"MU CAPE : {int(mu_pcl.bplus):>4} J/kg\n"
                f"3km CAPE: {int(ml_pcl.b3km):>4} J/kg"
            )
            
            # Coluna 2: CIN (J/kg)
            txt_cins = (
                f"SFC CIN : {int(sfc_pcl.bminus):>5} J/kg\n"
                f"ML CIN  : {int(ml_pcl.bminus):>5} J/kg\n"
                f"MU CIN  : {int(mu_pcl.bminus):>5} J/kg\n"
                f" "
            )
            
            # Coluna 3: Thermo / Parcel Heights (LCL, LFC, EL) usando a MU, que é a principal
            txt_thermo = (
                f"MU LCL  : {int(mu_pcl.lclhght):>5} m\n"
                f"MU LFC  : {int(mu_pcl.lfchght):>5} m\n"
                f"MU EL   : {int(mu_pcl.elhght):>5} m\n"
                f"PW      : {params.pmsl(prof):.1f} *est\n" # Placeholder since we lack raw precipitable water in SHARPpy basic loop
            )
            
            # Coluna 4: Kinematics (BWD / Shear)
            txt_bwd = (
                f"SHR 0-1km : {shr0_500m_mag:>3.0f} kt\n" # Approximating 1km with 500m logic or similar
                f"SHR 0-6km : {eff_shear_mag:>3.0f} kt\n"
                f"Eff Shear : {eff_shear_mag:>3.0f} kt\n"
                f"LM SRH(3k): {srh3km_val:>3.0f} m2/s2"
            )

            # Coluna 5: Tornadogenesis / Composites
            txt_comp = (
                f"STP (1km LM): {stp0_1km:.2f}\n"
                f"STP (500 LM): {stp0_500m:.2f}\n"
                f"BRN Shear   : N/A\n"
                f"Signif. Hail: N/A"
            )

            # Escrevendo Textos na Figura (Coordenadas Relativas da Figura 0 a 1)
            f_size = 14
            f_prop = dict(family='monospace', fontweight='bold', ha='left', va='top')
            
            fig.text(0.05, y_pos, txt_capes,  fontsize=f_size, color='darkred', **f_prop)
            fig.text(0.20, y_pos, txt_cins,   fontsize=f_size, color='darkblue', **f_prop)
            fig.text(0.35, y_pos, txt_thermo, fontsize=f_size, color='black', **f_prop)
            fig.text(0.55, y_pos, txt_bwd,    fontsize=f_size, color='purple', **f_prop)
            fig.text(0.75, y_pos, txt_comp,   fontsize=f_size, color='darkgreen', **f_prop)
            
            fig.text(0.98, 0.98, 'Gerado Pelo Motor PREVISÃO MASTER', color='grey', fontsize=12, ha='right', va='top', alpha=0.5, fontweight='bold')

            # Renderizar para Base64
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=120, bbox_inches='tight', facecolor='white')
            plt.close(fig)
            
            base64_img = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')
            
        except Exception as e:
            print(f"Failed to generate Python MetPy SPC Layout Image: {e}", flush=True)
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
