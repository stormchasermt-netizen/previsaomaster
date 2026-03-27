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
        
        # Perfil da Parcela
        parcel_prof = mpcalc.parcel_profile(p, t[0], td[0])
        
        # 3. Cálculos
        def _get_cape_cin(func):
            try:
                res = func(p, t, td)
                return res[0], res[1]
            except:
                return units.Quantity(0, 'J/kg'), units.Quantity(0, 'J/kg')

        sbcape, sbcin = _get_cape_cin(mpcalc.surface_based_cape_cin)
        # Mixed Layer e Most Unstable
        ml_p, ml_t, ml_td = mpcalc.mixed_layer(p, t, td, depth=500*units.m)
        ml_prof = mpcalc.parcel_profile(p, ml_t, ml_td)
        mlcape, mlcin = mpcalc.mixed_layer_cape_cin(p, t, td, depth=500*units.m)
        
        mu_p, mu_t, mu_td, mu_idx = mpcalc.most_unstable_parcel(p, t, td)
        mu_prof = mpcalc.parcel_profile(p[mu_idx:], mu_t, mu_td)
        mucape, mucin = mpcalc.most_unstable_cape_cin(p, t, td)
        
        # Lifted Index
        def _get_li(parcel_prof, p_env, t_env):
            try:
                idx_500 = np.abs(p_env.m - 50000).argmin()
                return (t_env[idx_500] - parcel_prof[idx_500]).to('degC').m
            except: return 0.0

        sb_li = _get_li(parcel_prof, p, t)
        ml_li = _get_li(ml_prof, p, t)
        mu_li = _get_li(mu_prof, p[mu_idx:], t[mu_idx:])

        # LCL, LFC, EL (Simple extraction)
        def _get_levels(p_par, t_par, p_env, t_env, td_env):
            try:
                lcl_p, lcl_t = mpcalc.lcl(p_par[0], t_par[0], td_env[0])
                lfc_p, lfc_t = mpcalc.lfc(p_env, t_env, td_env, t_par)
                el_p, el_t = mpcalc.el(p_env, t_env, td_env, t_par)
                # Convert P to Z (approx)
                def p_to_z(pres):
                    if pres is None or np.isnan(pres.m): return 0
                    idx = np.abs(p.m - pres.to('Pa').m).argmin()
                    return int(h[idx].m)
                return p_to_z(lcl_p), p_to_z(lfc_p), p_to_z(el_p)
            except: return 0, 0, 0

        sb_lcl, sb_lfc, sb_el = _get_levels(p, parcel_prof, p, t, td)
        ml_lcl, ml_lfc, ml_el = _get_levels(p, ml_prof, p, t, td)
        mu_lcl, mu_lfc, mu_el = _get_levels(p[mu_idx:], mu_prof, p, t, td)

        # Severe Indices (STP, SCP)
        try:
            # Simplificação para STP/SCP (MetPy requer parâmetros específicos)
            # Usaremos aproximações baseadas no CAPE e Shear se o MetPy falhar
            eff_shear = mpcalc.bulk_shear(p, u, v, depth=6000*units.m)
            shear_mag = np.sqrt(eff_shear[0]**2 + eff_shear[1]**2).to('m/s').m
            scp = (mucape.m / 1000.0) * (srh3k / 50.0) * (shear_mag / 20.0)
            stp = (mlcape.m / 1500.0) * ((2000 - ml_lcl)/1000.0) * (srh1k / 150.0) * (shear_mag / 20.0)
            if stp < 0: stp = 0
            if scp < 0: scp = 0
        except: scp = stp = 0.0

        # Lapse Rates
        def _get_lr(z_top):
            try:
                idx_top = np.abs(h.m - z_top).argmin()
                dt = (t[idx_top] - t[0]).to('degC').m
                dz = h[idx_top].m / 1000.0
                return -dt / dz
            except: return 0.0
        
        lr_03 = _get_lr(3000)
        lr_36 = _get_lr(6000)

        # 4. Plotagem (Layout SPC Expandido)
        base64_img = None
        if generate_image:
            plt.clf()
            # Aumentamos a altura para a tabela e removemos margens
            fig = plt.figure(figsize=(22, 14), facecolor='white')
            
            # Skew-T
            skew = SkewT(fig, rotation=45, subplot=(1, 2, 1))
            skew.plot(p, t, 'r', linewidth=2.5, label='Temp')
            skew.plot(p, td, 'g', linewidth=2.5, label='Dewp')
            skew.plot(p, parcel_prof, 'k', linestyle='--', alpha=0.5)
            skew.shade_cape(p, t, parcel_prof, alpha=0.15, facecolor='red')
            skew.shade_cin(p, t, parcel_prof, alpha=0.1, facecolor='blue')
            skew.plot_dry_adiabats(t0=np.arange(233, 533, 10)*units.K, alpha=0.2)
            
            _flip = latitude_override < 0
            skip = max(1, len(p)//25)
            skew.plot_barbs(p[::skip], u_kt[::skip], v_kt[::skip], flip_barb=_flip)
            
            skew.ax.set_ylim(1050, 100)
            skew.ax.set_xlim(-40, 50)
            skew.ax.set_title(f"{image_title} (Hem. {'Sul' if _flip else 'Norte'})", fontsize=15, fontweight='bold')

            # Hodograph
            hodo_ax = fig.add_subplot(1, 2, 2)
            hodo = Hodograph(hodo_ax, component_range=80.)
            hodo.add_grid(increment=20, color='gray', alpha=0.3, linestyle='--')
            
            # Segmentos coloridos
            z_m = h.m
            z_lvls = [0, 500, 1000, 3000, 6000, 12000]
            z_clrs = ['magenta', '#4B0082', 'red', 'orange', 'blue']
            for i in range(len(z_lvls)-1):
                mask = (z_m >= z_lvls[i]) & (z_m <= z_lvls[i+1])
                if np.sum(mask) >= 2:
                    hodo.plot(u_kt[mask], v_kt[mask], color=z_clrs[i], linewidth=4)
            
            # Labels Hodógrafa
            label_lvls = [0, 500, 1000, 3000, 6000, 9000, 12000]
            for lvl in label_lvls:
                try:
                    idx = np.abs(z_m - lvl).argmin()
                    if np.abs(z_m[idx] - lvl) < 600:
                        lbl = f"{lvl/1000:g}" if lvl > 0 else "0"
                        hodo_ax.text(u_kt[idx].m, v_kt[idx].m, lbl, fontsize=10, fontweight='bold', ha='center', va='center',
                                     bbox=dict(facecolor='white', alpha=0.8, edgecolor='none', pad=1))
                except: pass
            
            # Storm Motion
            try:
                hodo_ax.plot(lm[0].to('knots').m, lm[1].to('knots').m, 'ro', markersize=9, label='Left Mover (LM)')
                hodo_ax.plot(rm[0].to('knots').m, rm[1].to('knots').m, 'bo', markersize=9, label='Right Mover (RM)')
                hodo_ax.legend(loc='upper right', fontsize=11, frameon=True)
            except: pass
            
            hodo_ax.set_aspect('equal', 'box')
            hodo_ax.set_xlabel('knots', fontsize=12)

            # --- TABELA DE PARÂMETROS (SPC FULL STYLE) ---
            fig.subplots_adjust(left=0.05, right=0.95, bottom=0.32, top=0.92, wspace=0.15)
            f_mono = dict(family='monospace', fontsize=13, va='top', ha='left', fontweight='bold')
            
            # Tabela de Parcelas
            header = "PARCEL          CAPE  CINH  LCL    LI   LFC     EL"
            sbc = f"SFC (SB)      {int(sbcape.m):>5} {int(sbcin.m):>5} {int(sb_lcl):>5}m {int(sb_li):>4} {int(sb_lfc):>5}m {int(sb_el):>5}m"
            mlc = f"MIXED LAYER   {int(mlcape.m):>5} {int(mlcin.m):>5} {int(ml_lcl):>5}m {int(ml_li):>4} {int(ml_lfc):>5}m {int(ml_el):>5}m"
            muc = f"MOST UNSTABLE {int(mucape.m):>5} {int(mucin.m):>5} {int(mu_lcl):>5}m {int(mu_li):>4} {int(mu_lfc):>5}m {int(mu_el):>5}m"
            
            parcel_txt = f"{header}\n{'-'*54}\n{sbc}\n{mlc}\n{muc}"
            fig.text(0.05, 0.28, parcel_txt, **f_mono)

            # Índices Termodinâmicos e de Severidade
            col2_txt = (
                f"PW  = {pw.m:>5.1f} mm\n"
                f"K   = {int(mpcalc.k_index(p, t, td).m):>5}\n"
                f"Sfc-3km LR = {lr_03:>4.1f} C/km\n"
                f"3-6km Agl LR = {lr_36:>4.1f} C/km"
            )
            fig.text(0.45, 0.28, col2_txt, **f_mono)

            # Severe Box (Colorida se perigoso)
            scp_clr = 'red' if scp > 5 else 'black'
            stp_clr = 'red' if stp > 1 else 'black'
            
            severe_txt = (
                f"Supercell Comp = {scp:>4.1f}\n"
                f"STP (eff layer) = {stp:>4.1f}\n"
                f"SRH 1km (HS)    = {int(srh1k):>4}\n"
                f"SRH 3km (HS)    = {int(srh3k):>4}"
            )
            fig.text(0.72, 0.28, severe_txt, **f_mono, color='black')
            # Sobrescrevemos as linhas SCP/STP com cor se necessário
            fig.text(0.72, 0.28, f"Supercell Comp = {scp:>4.1f}", **f_mono, color=scp_clr)
            fig.text(0.72, 0.26, f"STP (eff layer) = {stp:>4.1f}", **f_mono, color=stp_clr)

            # Footer
            fig.text(0.05, 0.05, f"Previsão Master Sounding Engine v2.5 | Hemisfério Sul | {sm_label} Storm Motion", 
                     fontsize=12, color='gray', style='italic')

            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=95, bbox_inches='tight', pad_inches=0.1)
            plt.close(fig)
            base64_img = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')

        # 5. Saída
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
                "pw": float(pw.m)
            },
            "base64_img": base64_img
        }
            "base64_img": base64_img
        }

    except Exception as e:
        import traceback
        return {"error": f"Erro no processamento MetPy: {str(e)}", "trace": traceback.format_exc()}
