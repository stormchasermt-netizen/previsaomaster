import io
import base64
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from metpy.units import units
import metpy.calc as mpcalc
from metpy.plots import SkewT, Hodograph
import warnings

# Suprimir avisos do Pint/MetPy
warnings.filterwarnings("ignore", category=UserWarning)

def process_csv_content(csv_text, image_title="Sondagem", latitude_override=-23.5, native_spc=False, generate_image=True):
    """
    Processa o conteúdo CSV de uma sondagem e gera um dicionário com os dados do perfil
    e uma imagem base64 (MetPy High-Fidelity SPC Style).
    
    Hemisfério Sul como padrão (latitude_override < 0).
    """
    try:
        # Forçar latitude do Hemisfério Sul se for None ou se o usuário pediu para ignorar lat/lon do CSV
        if latitude_override is None:
            latitude_override = -23.5
            
        # 1. Leitura e Limpeza de Dados
        df = pd.read_csv(io.StringIO(csv_text))
        
        # Mapeamento de colunas flexível (suporta Pressure, Altitude, Temperature, Dew_point, Wind_direction, Wind_speed)
        col_map = {
            'Pressure': ['pressure', 'pres', 'p'],
            'Altitude': ['altitude', 'height', 'hght', 'z'],
            'Temperature': ['temperature', 'temp', 't', 'tmpc'],
            'Dew_point': ['dew_point', 'dwpt', 'td', 'dwpc'],
            'Wind_direction': ['wind_direction', 'wind_dir', 'wdir', 'drct', 'wd'],
            'Wind_speed': ['wind_speed', 'wind_sp', 'wspd', 'sped', 'ws']
        }
        
        normalized_df = pd.DataFrame()
        for target, aliases in col_map.items():
            for alias in aliases:
                match = [c for c in df.columns if c.lower().strip() == alias]
                if match:
                    normalized_df[target] = df[match[0]]
                    break
        
        df = normalized_df
        cols = list(col_map.keys())
        df[cols] = df[cols].replace([-9999, -999, -99.9, 9999, 999], np.nan)
        df = df.dropna(subset=cols).reset_index(drop=True)
        
        if df.empty:
            return {"error": "Dados insuficientes no CSV (verifique nomes das colunas)."}
        # 2. Extração de Variáveis com Unidades
        p = (df['Pressure'].values * units.hPa).to('Pa')
        h = (df['Altitude'].values - df['Altitude'].values[0]) * units.m # AGL
        t = (df['Temperature'].values * units.degC).to('kelvin')
        td = (df['Dew_point'].values * units.degC).to('kelvin')
        wd = df['Wind_direction'].values * units.degrees
        ws = df['Wind_speed'].values * units.knots
        
        u, v = mpcalc.wind_components(ws, wd)
        u_kt, v_kt = u.to('knots'), v.to('knots')
        
        # Perfil da Parcela Padrão (SFC)
        parcel_prof = mpcalc.parcel_profile(p, t[0], td[0])
        
        # --- CÁLCULOS AVANÇADOS (SPC STYLE) ---
        def _safe_calc(func, *args, **kwargs):
            try: return func(*args, **kwargs)
            except: return None

        # 1. Storm Motion e PW (Bunkers HS)
        try:
            rm, lm, mean = mpcalc.bunkers_storm_motion(p, u, v, h)
            _flip = latitude_override < 0
            sm_u, sm_v = (lm[0], lm[1]) if _flip else (rm[0], rm[1])
            sm_label = "LM" if _flip else "RM"
        except:
            sm_u = sm_v = units.Quantity(0, 'm/s')
            lm = rm = [sm_u, sm_v]
            sm_label = "SM"

        pw = _safe_calc(mpcalc.precipitable_water, p, td) or units.Quantity(0, 'mm')

        # 2. Helicity (SRH)
        def _get_srh(depth):
            try:
                res = mpcalc.storm_relative_helicity(h, u, v, depth=depth*units.m, storm_u=sm_u, storm_v=sm_v)
                return float(res[2].m)
            except: return 0.0

        srh1k = _get_srh(1000)
        srh3k = _get_srh(3000)

        # 3. Parcels (SFC, ML, MU)
        sbcape, sbcin = _safe_calc(mpcalc.surface_based_cape_cin, p, t, td) or (units.Quantity(0, 'J/kg'), units.Quantity(0, 'J/kg'))
        
        ml_res = _safe_calc(mpcalc.mixed_layer_cape_cin, p, t, td, depth=500*units.m)
        mlcape, mlcin = ml_res if ml_res else (units.Quantity(0, 'J/kg'), units.Quantity(0, 'J/kg'))
        ml_p_res = _safe_calc(mpcalc.mixed_parcel, p, t, td, depth=500*units.m)
        ml_prof = _safe_calc(mpcalc.parcel_profile, p, ml_p_res[1], ml_p_res[2]) if ml_p_res else parcel_prof

        mucape, mucin = _safe_calc(mpcalc.most_unstable_cape_cin, p, t, td) or (units.Quantity(0, 'J/kg'), units.Quantity(0, 'J/kg'))
        mu_p_res = _safe_calc(mpcalc.most_unstable_parcel, p, t, td)
        if mu_p_res:
            mu_prof = _safe_calc(mpcalc.parcel_profile, p[mu_p_res[3]:], mu_p_res[1], mu_p_res[2])
        else: mu_prof = parcel_prof

        # Lifted Index (LI)
        def _get_li(prof, p_env, t_env):
            try:
                p_m, t_m, prof_m = p_env.m.flatten(), t_env.m.flatten(), prof.m.flatten()
                if len(prof_m) < len(p_m): 
                    t_m = t_m[-len(prof_m):]; p_m = p_m[-len(prof_m):]
                idx_500 = np.abs(p_m - 50000).argmin()
                return (t_m[idx_500] - prof_m[idx_500]) - 273.15
            except: return 0.0

        sb_li, ml_li, mu_li = _get_li(parcel_prof, p, t), _get_li(ml_prof, p, t), _get_li(mu_prof, p, t)

        # LCL/LFC/EL
        def _get_levels(p_env, t_env, td_env, parcel_t_array):
            res = [0, 0, 0]
            try:
                size = len(parcel_t_array)
                p_c, t_c, td_c = p_env[-size:], t_env[-size:], td_env[-size:]
                lcl_p, _ = mpcalc.lcl(p_c[0], t_c[0], td_c[0])
                lfc_p, _ = mpcalc.lfc(p_c, t_c, td_c, parcel_t_array)
                el_p, _ = mpcalc.el(p_c, t_c, td_c, parcel_t_array)
                for i, pres in enumerate([lcl_p, lfc_p, el_p]):
                    try:
                        if pres and not np.isnan(pres.m):
                            idx = np.abs(p.m.flatten() - pres.to('Pa').m).argmin()
                            res[i] = int(h[idx].m)
                    except: pass
            except: pass
            return res

        sb_levs, ml_levs, mu_levs = _get_levels(p, t, td, parcel_prof), _get_levels(p, t, td, ml_prof), _get_levels(p, t, td, mu_prof)

        # --- CÁLCULOS ADICIONAIS (NOVO BOX) ---
        # 3CAPE (0-3km)
        try:
            p_3k = p[h <= 3000*units.m]
            t_3k = t[h <= 3000*units.m]
            td_3k = td[h <= 3000*units.m]
            prof_3k = ml_prof[h <= 3000*units.m]
            cape_3k = mpcalc.cape_cin(p_3k, t_3k, td_3k, prof_3k)[0].m
        except: cape_3k = 0.0
        
        # DCAPE
        dcape_val = 0.0
        try:
            # Downdraft CAPE: find min theta-e in lowest 6km
            mask_6k = h <= 6000*units.m
            theta_e = mpcalc.equivalent_potential_temperature(p[mask_6k], t[mask_6k], td[mask_6k])
            idx_min = np.argmin(theta_e)
            p_src, t_src, td_src = p[idx_size-len(p):][idx_min], t[idx_size-len(p):][idx_min], td[idx_size-len(p):][idx_min]
            # Saturated parcel descent
            # MetPy doesn't have a direct dcape function in all versions, let's approximate
            # Or use downdraft_cape if available
            dc_res = mpcalc.downdraft_cape(p, t, td)
            dcape_val = float(dc_res[0].m)
        except: dcape_val = 0.0

        # WBZ / FZL
        def _get_z_level(qty, target):
            try:
                # Interpolate to find where qty crosses target
                idx = np.where(np.diff(np.sign(qty.m - target)))[0]
                if len(idx) > 0:
                    i = idx[0]
                    # Linear interp
                    fraction = (target - qty.m[i]) / (qty.m[i+1] - qty.m[i])
                    z = h.m[i] + fraction * (h.m[i+1] - h.m[i])
                    return int(z * 3.28084) # results in ft
                return 0
            except: return 0

        fzl = _get_z_level(t.to('degC'), 0)
        wb = mpcalc.wet_bulb_temperature(p, t, td).to('degC')
        wbz = _get_z_level(wb, 0)
        
        # ESP / WNDG
        esp = (cape_3k / 50.0) * (srh1k / 100.0) * (mlcape.m / 1000.0)
        wndg = (mucape.m / 2000.0) * (dcape_val / 1000.0)
        esp, wndg = max(0, esp), max(0, wndg)

        # 4. Plotagem (SPC Full Style)
        if generate_image:
            plt.clf()
            fig = plt.figure(figsize=(22, 14), facecolor='white')
            fig.subplots_adjust(left=0.02, right=0.98, bottom=0.32, top=0.95, wspace=0.1)
            
            # Skew-T
            skew = SkewT(fig, rotation=45, subplot=(1, 2, 1))
            skew.plot(p, t, 'r', linewidth=3)
            skew.plot(p, td, 'g', linewidth=3)
            # USAR ML PARCEL NO DIAGRAMA
            plot_prof = ml_prof if ml_prof is not None else parcel_prof
            skew.plot(p, plot_prof, 'k', linestyle='--', alpha=0.7)
            skew.shade_cape(p, t, plot_prof, alpha=0.2, facecolor='red')
            skew.shade_cin(p, t, plot_prof, alpha=0.1, facecolor='blue')
            skew.plot_dry_adiabats(alpha=0.15); skew.plot_moist_adiabats(alpha=0.15); skew.plot_mixing_lines(alpha=0.15)
            skew.ax.set_ylim(1050, 100); skew.ax.set_xlim(-40, 50)
            skew.ax.set_title(image_title, fontsize=18, fontweight='bold')
            skew.plot_barbs(p[::max(1, len(p)//30)], u_kt[::max(1, len(p)//30)], v_kt[::max(1, len(p)//30)], flip_barb=_flip)

            # Hodograph
            hodo_ax = fig.add_subplot(1, 2, 2)
            hodo = Hodograph(hodo_ax, component_range=80.)
            hodo.add_grid(increment=20, color='gray', alpha=0.3, linestyle='--')
            
            # Sombra de Vorticidade (Streamwise)
            try:
                idx_500 = np.abs(h.m - 500).argmin()
                u_h, v_h = u_kt[:idx_500+1].m, v_kt[:idx_500+1].m
                hodo_ax.fill(np.append(u_h, [sm_u.to('knots').m, u_h[0]]), 
                             np.append(v_h, [sm_v.to('knots').m, v_h[0]]), 
                             'red', alpha=0.3)
            except: pass

            z_m = h.m
            z_clrs = ['magenta', '#4B0082', 'red', 'orange', 'blue']
            for i, z_top in enumerate([500, 1000, 3000, 6000, 12000]):
                z_bot = [0, 500, 1000, 3000, 6000][i]
                mask = (z_m >= z_bot) & (z_m <= z_top)
                if np.sum(mask) >= 2: hodo.plot(u_kt[mask], v_kt[mask], color=z_clrs[i], linewidth=5)
            
            for lvl in [0, 0.5, 1, 3, 6, 9, 12]:
                try:
                    idx = np.abs(z_m - lvl*1000).argmin()
                    hodo_ax.text(u_kt[idx].m, v_kt[idx].m, f"{lvl:g}", fontsize=11, fontweight='bold', ha='center', va='center', bbox=dict(facecolor='white', alpha=0.8, edgecolor='none', pad=1))
                except: pass
            
            try:
                # Vetor de Tempestade (Seta)
                hodo_ax.arrow(0, 0, sm_u.to('knots').m, sm_v.to('knots').m, color='gray', 
                              linewidth=3, head_width=2, head_length=3, length_includes_head=True, alpha=0.6)
                hodo_ax.plot(lm[0].to('knots').m, lm[1].to('knots').m, 'ro', markersize=10, label='LM')
                hodo_ax.plot(rm[0].to('knots').m, rm[1].to('knots').m, 'bo', markersize=10, label='RM')
                hodo_ax.legend(loc='upper right', fontsize=12)
            except: pass
            hodo_ax.set_xlabel('knots', fontsize=12)

            # --- TABELAS ---
            f_mono = dict(family='monospace', fontsize=15, va='top', ha='left', fontweight='bold')
            hdr = "PARCEL          CAPE  CINH  LCL    LI   LFC     EL"
            sbc_t = f"SFC (SB)      {int(sbcape.m):>5} {int(sbcin.m):>5} {int(sb_levs[0]):>5}m {int(sb_li):>4} {int(sb_levs[1]):>5}m {int(sb_levs[2]):>5}m"
            mlc_t = f"MIXED LAYER   {int(mlcape.m):>5} {int(mlcin.m):>5} {int(ml_levs[0]):>5}m {int(ml_li):>4} {int(ml_levs[1]):>5}m {int(ml_levs[2]):>5}m"
            muc_t = f"MOST UNSTABLE {int(mucape.m):>5} {int(mucin.m):>5} {int(mu_levs[0]):>5}m {int(mu_li):>4} {int(mu_levs[1]):>5}m {int(mu_levs[2]):>5}m"
            fig.text(0.04, 0.28, f"{hdr}\n{'-'*54}\n{sbc_t}\n{mlc_t}\n{muc_t}", **f_mono)

            # Novo Box de Parâmetros (Bottom Left)
            box_txt = (
                f"PW  = {pw.to('in').m:>4.2f} in   3CAPE = {int(cape_3k):>4} J/kg   WBZ = {int(wbz):>5} ft   WNDG = {wndg:>4.1f}\n"
                f"K   = {int(k_val):>4}      DCAPE = {int(dcape_val):>4} J/kg   FZL = {int(fzl):>5} ft   ESP  = {esp:>4.1f}\n"
                f"Sfc-3km LR = {lr03:>4.1f} C/km   3-6km Agl LR = {lr36:>4.1f} C/km"
            )
            fig.text(0.04, 0.16, box_txt, **f_mono, bbox=dict(facecolor='none', edgecolor='black', pad=10))

            scp_clr = 'red' if scp > 5 else 'black'
            stp_clr = 'red' if stp > 1 else 'black'
            severe = f"Supercell Comp = {scp:>4.1f}\nSTP (eff layer) = {stp:>4.1f}\nSRH 1km (HS)    = {int(srh1k):>4}\nSRH 3km (HS)    = {int(srh3k):>4}"
            fig.text(0.74, 0.28, severe, **f_mono)
            fig.text(0.74, 0.28, f"Supercell Comp = {scp:>4.1f}", **f_mono, color=scp_clr)
            fig.text(0.74, 0.26, f"STP (eff layer) = {stp:>4.1f}", **f_mono, color=stp_clr)

            fig.text(0.04, 0.05, f"Previsão Master v2.5 | {sm_label} Motion | Hemisfério Sul", fontsize=14, color='gray')

            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=100, bbox_inches='tight')
            plt.close(fig)
            base64_img = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')

        profile_out = []
        for i in range(len(df)):
            profile_out.append({
                "pressure": float(df['Pressure'][i]), "height": float(df['Altitude'][i]),
                "temp": float(df['Temperature'][i]), "dwpt": float(df['Dew_point'][i]),
                "u": float(u_kt[i].m), "v": float(v_kt[i].m)
            })

        return {
            "profile": profile_out,
            "parcel": [{"pressure": float(pm), "temp": float(tm - 273.15)} for pm, tm in zip(p.m, parcel_prof.m)],
            "indices": {
                "sbcape": float(sbcape.m), "sbcin": float(sbcin.m),
                "mlcape": float(mlcape.m), "mlcin": float(mlcin.m),
                "mucape": float(mucape.m), "mucin": float(mucin.m),
                "scp": float(scp), "stp": float(stp),
                "pw": float(pw.m), "dcape": float(dcape_val), "3cape": float(cape_3k)
            },
            "base64_img": base64_img
        }

    except Exception as e:
        import traceback
        return {"error": f"Erro MetPy: {str(e)}", "trace": traceback.format_exc()}
