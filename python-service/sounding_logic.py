import pandas as pd
import numpy as np
import io
import datetime
import tempfile
import subprocess
import base64
import os
import sys
from typing import Optional
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

# Latitude padrão: Hemisfério Sul (ex.: interior SP). SHARPpy usa latitude<0 para lógica de hemisfério.
_DEFAULT_SITE_LATITUDE = -23.5


def _site_latitude_from_df(df: pd.DataFrame, raw_lines: list, latitude_override: Optional[float]) -> float:
    if latitude_override is not None:
        return float(latitude_override)
    for col in ("latitude", "lat", "site_lat"):
        if col in df.columns:
            s = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(s) > 0:
                v = float(s.iloc[0])
                if -90.0 <= v <= 90.0:
                    return v
    for line in raw_lines[:30]:
        low = line.strip().lower()
        if "latitude" in low or low.startswith("lat") or "site_lat" in low:
            for part in line.replace("=", ",").replace(";", ",").split(","):
                part = part.strip()
                try:
                    v = float(part)
                    if -90.0 <= v <= 90.0:
                        return v
                except ValueError:
                    continue
    return _DEFAULT_SITE_LATITUDE


def _env_wants_native_spc() -> bool:
    return os.environ.get("NATIVE_SPC_RENDER", "").strip().lower() in ("1", "true", "yes")


def _native_spc_render_available() -> bool:
    try:
        import sharppy.plot.skew  # noqa: F401
    except ImportError:
        return False
    return True


def _try_render_sharppy_spc_native(
    p, z, t, td, wd, ws, latitude: float
) -> Optional[str]:
    """Imagem estilo SHARPpy via sharppy.plot.skew (Matplotlib; ver sharppy_renderer.py)."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sharppy_renderer.py")
    if not os.path.isfile(script):
        return None
    fd_in, in_path = tempfile.mkstemp(suffix=".csv")
    fd_out, out_path = tempfile.mkstemp(suffix=".png")
    try:
        os.close(fd_in)
        os.close(fd_out)
        pd.DataFrame(
            {"pres": p, "hght": z, "temp": t, "dwpt": td, "wdir": wd, "wspd": ws}
        ).to_csv(in_path, index=False)
        env = os.environ.copy()
        env["SOUNDING_LATITUDE"] = str(latitude)
        cmd = [sys.executable, script, in_path, out_path]
        r = subprocess.run(
            cmd, env=env, timeout=120, capture_output=True, text=True
        )
        if r.returncode != 0:
            print(f"native SPC render failed: {r.stderr or r.stdout}", flush=True)
            return None
        with open(out_path, "rb") as f:
            raw = f.read()
        if not raw:
            return None
        return "data:image/png;base64," + base64.b64encode(raw).decode("utf-8")
    except Exception as e:
        print(f"native SPC render exception: {e}", flush=True)
        return None
    finally:
        for path in (in_path, out_path):
            try:
                os.unlink(path)
            except OSError:
                pass


def process_csv_content(
    csv_text: str,
    generate_image: bool = False,
    image_title: str = "Tornado Track Sounding",
    latitude_override: Optional[float] = None,
    native_spc: bool = False,
):
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

    site_latitude = _site_latitude_from_df(df, lines, latitude_override)

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
    
    # Fix: Provide a dummy date to avoid 'NoneType' strftime errors in SHARPpy.
    # latitude < 0 ativa lógica de hemisfério sul no SHARPpy (parcelas, hodógrafo, etc.).
    prof = profile.create_profile(
        profile='convective',
        pres=p, hght=z, tmpc=t, dwpc=td, wdir=wd, wspd=ws,
        missing=-9999,
        date=datetime.datetime.now(),
        latitude=site_latitude,
    )
    
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

    # === Imagem: layout SPC (SHARPpy SPCWindo + Qt + xvfb) ou MetPy (fallback) ===
    base64_img = None
    if generate_image:
        if (native_spc or _env_wants_native_spc()) and _native_spc_render_available():
            b64 = _try_render_sharppy_spc_native(p, z, t, td, wd, ws, site_latitude)
            if b64:
                base64_img = b64
        if base64_img is None:
            try:
                # === CONFIGURAÇÃO ESTÉTICA (SPC PROFESSIONAL) ===
                plt.rcParams['font.family'] = 'monospace'
                plt.rcParams['font.size'] = 10
                
                # 1. FIGURA ÚNICA INTEGRADA (Proporção Retrato/Quadrada para o Site)
                fig = plt.figure(figsize=(12, 14), facecolor='white')
                
                # Definimos um GridSpec para organizar a área da Skew-T e o Painel de Texto Lateral/Inferior
                # 3 linhas: Título (0.05), Gráfico Principal (0.75), Parâmetros (0.20)
                gs = fig.add_gridspec(3, 1, height_ratios=[0.5, 9, 2.5], hspace=0.1)
                
                # -- TÍTULO --
                ax_title = fig.add_subplot(gs[0])
                ax_title.axis('off')
                ax_title.text(0.02, 0.5, f"Previsão Master - {image_title}", fontsize=16, fontweight='bold', ha='left', va='center')
                ax_title.text(0.98, 0.5, f"Lat: {site_latitude:.2f} | SHARPpy Engine", fontsize=10, color='gray', ha='right', va='center')

                # -- ÁREA DO GRÁFICO (SKEW-T) --
                skew = SkewT(fig, rotation=35, subplot=gs[1])
                
                p_units = p * units.hPa
                t_units = t * units.degC
                td_units = td * units.degC
                u_arr = np.array([u_ if u_ != prof.missing else np.nan for u_ in prof.u]) * units.knots
                v_arr = np.array([v_ if v_ != prof.missing else np.nan for v_ in prof.v]) * units.knots
                
                # Curvas Bold (NWS Style)
                skew.plot(p_units, t_units, 'red', linewidth=3.0, alpha=0.9, label='Temp')
                skew.plot(p_units, td_units, 'green', linewidth=3.0, alpha=0.9, label='Dewp')
                
                # Curva da Parcela MU (Tracejada preta)
                mu_ptrace = mu_pcl.ptrace * units.hPa
                mu_ttrace = mu_pcl.ttrace * units.degC
                skew.plot(mu_ptrace, mu_ttrace, 'black', linestyle='--', linewidth=1.5, alpha=0.8)
                
                # Sombreamento CAPE/CIN
                try:
                    skew.shade_cape(p_units, t_units, mu_ttrace, alpha=0.15, facecolor='red')
                    skew.shade_cin(p_units, t_units, mu_ttrace, alpha=0.15, facecolor='blue')
                except:
                    pass
                
                # Grades Termodinâmicas (Sutis)
                skew.plot_dry_adiabats(t0=np.arange(233, 533, 10) * units.K, color='tan', alpha=0.3, linewidth=0.5)
                skew.plot_moist_adiabats(color='blue', alpha=0.2, linewidth=0.5)
                skew.plot_mixing_lines(color='green', alpha=0.2, linestyle='dotted', linewidth=0.5)
                skew.ax.axvline(0, color='blue', linestyle='--', alpha=0.4)
                
                # Barbelas de Vento (Lado Direito)
                wind_skip = max(1, len(p_units)//30)
                _flip = site_latitude < 0
                try:
                    skew.plot_barbs(p_units[::wind_skip], u_arr[::wind_skip], v_arr[::wind_skip], flip_barb=_flip, length=6)
                except:
                    skew.plot_barbs(p_units[::wind_skip], u_arr[::wind_skip], v_arr[::wind_skip], length=6)
                
                skew.ax.set_ylim(1050, 100)
                skew.ax.set_xlim(-40, 50)
                skew.ax.set_ylabel('Pressão (hPa)', fontsize=10)
                skew.ax.set_xlabel('Temperatura (°C)', fontsize=10)

                # -- HODÓGRAFO EM INSET (Topo Direito da Skew-T) --
                from mpl_toolkits.axes_grid1.inset_locator import inset_axes
                ax_hodo = inset_axes(skew.ax, width="40%", height="40%", loc='upper right', borderpad=1)
                h = Hodograph(ax_hodo, component_range=80.)
                h.add_grid(increment=20, color='gray', alpha=0.3, linestyle='--')
                
                # Dados até 12km para Hodógrafa
                z_mask = (z <= 12000) & ~np.isnan(u_arr.magnitude)
                h.plot_colormapped(u_arr[z_mask], v_arr[z_mask], z[z_mask], cmap='jet', linewidth=2.5)
                
                # Bunkers Storm Motion
                if srwind:
                    h.plot(lm_u, lm_v, marker='o', color='red', markersize=8, label='LM')
                    h.plot(srwind[0], srwind[1], marker='o', color='blue', markersize=8, label='RM')
                
                ax_hodo.set_title("Hodógrafo (nós)", fontsize=9, fontweight='bold')
                ax_hodo.tick_params(labelsize=7)

                # -- PAINEL DE PARÂMETROS (RODAPÉ) --
                ax_params = fig.add_subplot(gs[2])
                ax_params.axis('off')
                
                # Cálculos finais para o texto
                pw_val = params.precip_water(prof)
                
                col1 = (
                    f"--- TERMODINÂMICA ---\n"
                    f"SFC CAPE: {int(sfc_pcl.bplus):>4} J/kg\n"
                    f"ML CAPE : {int(ml_pcl.bplus):>4} J/kg\n"
                    f"MU CAPE : {int(mu_pcl.bplus):>4} J/kg\n"
                    f"ML CIN  : {int(ml_pcl.bminus):>4} J/kg"
                )
                
                col2 = (
                    f"--- ALTURAS (m) ---\n"
                    f"MU LCL  : {int(mu_pcl.lclhght):>5}\n"
                    f"MU LFC  : {int(mu_pcl.lfchght):>5}\n"
                    f"MU EL   : {int(mu_pcl.elhght):>5}\n"
                    f"PW      : {pw_val:>5.1f} mm"
                )
                
                col3 = (
                    f"--- CINEMÁTICA (kt) ---\n"
                    f"Eff. Shear : {eff_shear_mag:>5.1f}\n"
                    f"SHR 0-6km  : {shr0_6km_mag:>5.1f}\n"
                    f"LM SRH 1km : {srh1km_val:>5.0f} m2/s2\n"
                    f"LM SRH 3km : {srh3km_val:>5.0f} m2/s2"
                )
                
                col4 = (
                    f"--- ÍNDICES COMP. ---\n"
                    f"STP (1km) : {stp0_1km:>5.2f}\n"
                    f"STP (500) : {stp0_500m:>5.2f}\n"
                    f"Site Lat  : {site_latitude:>5.2f}\n"
                    f"Hemi      : {'SUL' if site_latitude < 0 else 'NORTE'}"
                )

                ax_params.text(0.02, 0.9, col1, family='monospace', fontsize=11, va='top', ha='left')
                ax_params.text(0.28, 0.9, col2, family='monospace', fontsize=11, va='top', ha='left')
                ax_params.text(0.53, 0.9, col3, family='monospace', fontsize=11, va='top', ha='left')
                ax_params.text(0.80, 0.9, col4, family='monospace', fontsize=11, va='top', ha='left')

                # Exportar
                buf = io.BytesIO()
                plt.savefig(buf, format='png', dpi=110, bbox_inches='tight', facecolor='white')
                plt.close(fig)
                base64_img = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')
                
            except Exception as e:
                import traceback
                print(f"FAILED NATIVE RENDER: {e}\n{traceback.format_exc()}", flush=True)
                base64_img = f"ERROR: {str(e)}"

    return {
        "profile": profile_data,
        "parcel": parcel_data,
        "indices": indices,
        "base64_img": base64_img,
        "site_latitude": site_latitude,
    }

def interp_p(prof, hght_agl):
    """ Helper to interpolate pressure at a given AGL height """
    target_hght = hght_agl + prof.hght[prof.sfc]
    return np.interp(target_hght, prof.hght, prof.pres)
