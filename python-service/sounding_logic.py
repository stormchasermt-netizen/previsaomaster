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
        mlcape, mlcin = _get_cape_cin(mpcalc.mixed_layer_cape_cin)
        mucape, mucin = _get_cape_cin(mpcalc.most_unstable_cape_cin)
        
        try:
            pw = mpcalc.precipitable_water(p, td).to('mm')
        except:
            pw = units.Quantity(0, 'mm')

        # Bunkers Storm Motion (Hemisfério Sul)
        try:
            rm, lm, mean = mpcalc.bunkers_storm_motion(p, u, v, h)
            # Hemisfério Sul: Usa Left Mover (LM)
            sm_u, sm_v = (lm[0], lm[1]) if latitude_override < 0 else (rm[0], rm[1])
            sm_label = "LM" if latitude_override < 0 else "RM"
        except:
            sm_u = sm_v = units.Quantity(0, 'm/s')
            sm_label = "SM"

        # SRH Total
        def _get_srh(depth):
            try:
                res = mpcalc.storm_relative_helicity(h, u, v, depth=depth*units.m, storm_u=sm_u, storm_v=sm_v)
                return res[2].m
            except: return 0.0

        srh1k = _get_srh(1000)
        srh3k = _get_srh(3000)

        # 4. Plotagem (22x11 SPC Style)
        base64_img = None
        if generate_image:
            plt.clf()
            fig = plt.figure(figsize=(22, 11), facecolor='white')
            
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
            skew.ax.set_title(f"{image_title} (Hem. {'Sul' if _flip else 'Norte'})", fontsize=14, fontweight='bold')

            # Hodograph
            hodo_ax = fig.add_subplot(1, 2, 2)
            hodo = Hodograph(hodo_ax, component_range=80.)
            hodo.add_grid(increment=20, color='gray', alpha=0.3, linestyle='--')
            
            z_m = h.m
            z_lvls = [0, 500, 3000, 6000, 10000]
            z_clrs = ['magenta', 'red', 'green', 'blue']
            for i in range(len(z_lvls)-1):
                mask = (z_m >= z_lvls[i]) & (z_m <= z_lvls[i+1])
                if np.sum(mask) >= 2:
                    hodo.plot(u_kt[mask], v_kt[mask], color=z_clrs[i], linewidth=3)
            
            if not np.isnan(sm_u.m):
                hodo_ax.plot(sm_u.to('knots').m, sm_v.to('knots').m, 'ro', markersize=10, label=f'Storm Motion ({sm_label})')
            
            hodo_ax.set_aspect('equal', 'box')
            hodo_ax.legend(loc='upper right')

            # Tabela de Parâmetros
            fig.subplots_adjust(bottom=0.22)
            f_prop = dict(family='monospace', fontsize=12, va='top', ha='left', fontweight='bold')
            col1 = f"SBCAPE: {int(sbcape.m):>5} J/kg\nMLCAPE: {int(mlcape.m):>5} J/kg\nMUCAPE: {int(mucape.m):>5} J/kg"
            col2 = f"SBCIN:  {int(sbcin.m):>5} J/kg\nMLCIN:  {int(mlcin.m):>5} J/kg\nPW:     {pw.m:>5.1f} mm"
            col3 = f"SRH 1k: {int(srh1k):>5} m2/s2\nSRH 3k: {int(srh3k):>5} m2/s2\nHemi:   {'SUL' if _flip else 'NORTE'}"
            
            fig.text(0.08, 0.15, col1, **f_prop)
            fig.text(0.35, 0.15, col2, **f_prop)
            fig.text(0.65, 0.15, col3, **f_prop)

            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=90, bbox_inches='tight')
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
                "mu_lcl": 0, "mu_lfc": 0, "mu_el": 0,
                "shr0_1km": 0.0, "shr0_6km": 0.0,
                "srh1km": float(srh1k), "srh3km": float(srh3k),
                "pw": float(pw.m)
            },
            "base64_img": base64_img
        }

    except Exception as e:
        import traceback
        return {"error": f"Erro no processamento MetPy: {str(e)}", "trace": traceback.format_exc()}
