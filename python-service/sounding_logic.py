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

# Suprimir avisos do Pint/MetPy para evitar poluição no log do Cloud Run
warnings.filterwarnings("ignore", category=UserWarning)

def process_csv_content(csv_content, image_title="Sondagem", site_latitude=-23.5, native_spc=False, generate_image=True):
    """
    Processa o conteúdo CSV de uma sondagem e gera um dicionário com os dados do perfil
    e uma imagem base64 de alta resolução (Layout SPC Duplo via MetPy).
    
    Baseado no script hodografa_2.py aprovado pelo usuário.
    """
    try:
        # 1. LEITURA E LIMPEZA (Lógica hodografa_2.py)
        # Substitui -9999 e outros placeholders por NaN e remove linhas corrompidas
        df = pd.read_csv(io.StringIO(csv_content))
        cols = ['Pressure', 'Altitude', 'Temperature', 'Dew_point', 'Wind_direction', 'Wind_speed']
        
        # Garante que as colunas existam, se não, tenta mapear as mais comuns
        mapping = {
            'pres': 'Pressure', 'hght': 'Altitude', 'tmpc': 'Temperature', 
            'dwpc': 'Dew_point', 'drct': 'Wind_direction', 'sped': 'Wind_speed'
        }
        for old, new in mapping.items():
            if old in df.columns and new not in df.columns:
                df[new] = df[old]
                
        df[cols] = df[cols].replace([-9999, -999, -99.9, 9999, 999], np.nan)
        df = df.dropna(subset=cols).reset_index(drop=True)
        
        if df.empty:
            return {"error": "Dados de sondagem insuficientes após limpeza."}

        # 2. EXTRAÇÃO DE VARIÁVEIS COM UNIDADES
        # Pressão em Pa (MetPy prefere Pa para alguns cálculos internos)
        p = (df['Pressure'].values * units.hPa).to('Pa')
        
        # Altitude MSL para AGL (solo = 0m)
        altitudes_msl = df['Altitude'].values
        h = (altitudes_msl - altitudes_msl[0]) * units.m
        
        t = (df['Temperature'].values * units.degC).to('kelvin')
        td = (df['Dew_point'].values * units.degC).to('kelvin')
        wd = df['Wind_direction'].values * units.degrees
        ws = df['Wind_speed'].values * units.knots
        
        # Componentes do vento
        u, v = mpcalc.wind_components(ws, wd)
        u_kt, v_kt = u.to('knots'), v.to('knots')
        
        # Perfil da Parcela (Surface-Based)
        parcel_prof = mpcalc.parcel_profile(p, t[0], td[0])
        
        # 3. CÁLCULOS TERMODINÂMICOS
        def _get_cape_cin(func):
            try:
                res = func(p, t, td)
                return res[0], res[1]
            except:
                return units.Quantity(0, 'J/kg'), units.Quantity(0, 'J/kg')

        sbcape, sbcin = _get_cape_cin(mpcalc.surface_based_cape_cin)
        mlcape, mlcin = _get_cape_cin(mpcalc.mixed_layer_cape_cin)
        mucape, mucin = _get_cape_cin(mpcalc.most_unstable_cape_cin)
        
        # CAPE 0-3km
        try:
            lfc_p, _ = mpcalc.lfc(p, t, td)
            p_3km = np.interp(3000, h.m, p.m) * units.Pa
            mask_3k = (p <= lfc_p) & (p >= p_3km)
            cape_3km = mpcalc.cape_cin(p[mask_3k], t[mask_3k], td[mask_3k], parcel_prof[mask_3k])[0] if np.any(mask_3k) else 0*units('J/kg')
        except:
            cape_3km = 0*units('J/kg')

        # Água Precipitada (PW) - FIXED: Substituído params.pmsl por MetPy
        try:
            pw = mpcalc.precipitable_water(p, td).to('mm')
        except:
            pw = units.Quantity(0, 'mm')

        # Nível de Congelamento (FZL)
        try:
            fz_idx = np.where(t.to('degC').m <= 0)[0]
            fz_h = h.m[fz_idx[0]] if len(fz_idx) > 0 else np.nan
        except: fz_h = np.nan

        # 4. CINEMÁTICA (BWD, SRH e Storm Motion)
        def get_bwd(depth_m):
            try:
                u_top = np.interp(depth_m, h.m, u_kt.m)
                v_top = np.interp(depth_m, h.m, v_kt.m)
                return np.sqrt((u_top - u_kt.m[0])**2 + (v_top - v_kt.m[0])**2)
            except: return 0.0

        shr1k = get_bwd(1000)
        shr6k = get_bwd(6000)

        # Bunkers Storm Motion (Ajustado para Hemisfério Sul)
        try:
            rm, lm, mean = mpcalc.bunkers_storm_motion(p, u, v, h)
            # No Hemisfério Sul, o Left Mover (LM) é a referência para tempestades severas
            sm_u, sm_v = (lm[0], lm[1]) if site_latitude < 0 else (rm[0], rm[1])
            sm_label = "LM" if site_latitude < 0 else "RM"
        except:
            sm_u = sm_v = units.Quantity(np.nan, 'm/s')
            sm_label = "SM"

        # Helicidade Relativa (SRH)
        def calc_srh(depth_m):
            try:
                # Retorna (Positiva, Negativa, Total) - pegamos Total [2]
                res = mpcalc.storm_relative_helicity(h, u, v, depth=depth_m*units.m, storm_u=sm_u, storm_v=sm_v)
                return res[2].m
            except: return 0.0

        srh1k = calc_srh(1000)
        srh3k = calc_srh(3000)

        # 5. RENDERIZAÇÃO (Layout 22x11 Professional)
        base64_img = None
        if generate_image:
            plt.clf()
            fig = plt.figure(figsize=(22, 11), facecolor='white')
            fig.subplots_adjust(bottom=0.22, top=0.92, left=0.05, right=0.95)
            
            # --- SKEW-T (Lado Esquerdo) ---
            skew = SkewT(fig, rotation=45, subplot=(1, 2, 1))
            skew.plot(p, t, 'r', linewidth=2.5, label='Temp')
            skew.plot(p, td, 'g', linewidth=2.5, label='Dewp')
            skew.plot(p, parcel_prof, 'black', linestyle='--', linewidth=1.5, alpha=0.7)
            
            # Sombreamentos
            try:
                skew.shade_cape(p, t, parcel_prof, alpha=0.2, facecolor='red')
                skew.shade_cin(p, t, parcel_prof, alpha=0.1, facecolor='blue')
            except: pass
            
            # Grades
            skew.plot_dry_adiabats(t0=np.arange(233, 533, 10)*units.K, color='tan', alpha=0.3, linewidth=0.5)
            skew.plot_moist_adiabats(color='blue', alpha=0.1, linewidth=0.5)
            skew.ax.axvline(0, color='blue', linestyle='--', alpha=0.3)
            
            # Barbelas
            skip = max(1, len(p)//25)
            _flip = site_latitude < 0
            skew.plot_barbs(p[::skip], u_kt[::skip], v_kt[::skip], flip_barb=_flip, length=6)
            
            skew.ax.set_ylim(1050, 100)
            skew.ax.set_xlim(-40, 50)
            skew.ax.set_title(f"Análise Convectiva: {image_title}", fontsize=16, fontweight='bold', loc='left')
            skew.ax.set_xlabel("Temperatura (°C)")
            skew.ax.set_ylabel("Pressão (hPa)")

            # --- HODOGRAPH (Lado Direito) ---
            hodo_ax = fig.add_subplot(1, 2, 2)
            hodo = Hodograph(hodo_ax, component_range=80.)
            hodo.add_grid(increment=20, color='gray', alpha=0.4, linestyle='--')
            
            # Segmentos coloridos (Padrão SPC: 0-500m Magenta, 0.5-3k Red, 3-6k Green, 6-10k Blue)
            z_m = h.m
            z_lvls = [0, 500, 3000, 6000, 10000]
            z_clrs = ['magenta', 'red', 'green', 'blue']
            for i in range(len(z_lvls)-1):
                mask = (z_m >= z_lvls[i]) & (z_m <= z_lvls[i+1])
                if np.sum(mask) >= 2:
                    hodo.plot(u_kt[mask], v_kt[mask], color=z_clrs[i], linewidth=3.5)
            
            # Storm Motion Marker
            if not np.isnan(sm_u.m):
                hodo_ax.plot(sm_u.to('knots').m, sm_v.to('knots').m, 'ro', markersize=10, label=f'Storm Motion ({sm_label})')
            
            hodo_ax.set_aspect('equal', 'box')
            hodo_ax.set_title("Hodógrafo (Vento em Nós)", fontsize=14)
            hodo_ax.legend(loc='upper right', fontsize=10)

            # --- PAINEL DE PARÂMETROS (Rodapé) ---
            f_prop = dict(family='monospace', fontsize=13, va='top', ha='left', fontweight='bold')
            y_base = 0.16
            
            col1 = f"SBCAPE: {int(sbcape.m):>5} J/kg\nMLCAPE: {int(mlcape.m):>5} J/kg\nMUCAPE: {int(mucape.m):>5} J/kg\n3kCAPE: {int(cape_3km.m):>5} J/kg"
            col2 = f"SBCIN:  {int(sbcin.m):>5} J/kg\nMLCIN:  {int(mlcin.m):>5} J/kg\nMUCIN:  {int(mucin.m):>5} J/kg\nPW:     {pw.m:>5.1f} mm"
            col3 = f"SHR 1k: {shr1k:>5.1f} kt\nSHR 6k: {shr6k:>5.1f} kt\nFZL:    {int(fz_h) if not np.isnan(fz_h) else 'N/A':>5} m"
            col4 = f"SRH 1k: {int(srh1k):>5} m2/s2\nSRH 3k: {int(srh3k):>5} m2/s2\nHemi:   {'SUL' if _flip else 'NORTE'}"
            col5 = f"Lat:    {site_latitude:.2f}\nMotor:  MetPy/PM-V2\nStatus: Pixel Perfect"

            fig.text(0.05, y_base, col1, **f_prop)
            fig.text(0.25, y_base, col2, **f_prop)
            fig.text(0.45, y_base, col3, **f_prop)
            fig.text(0.65, y_base, col4, **f_prop)
            fig.text(0.82, y_base, col5, color='gray', **f_prop)

            # --- EXPORTAÇÃO BASE64 ---
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=100, bbox_inches='tight')
            plt.close(fig)
            base64_img = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')

        # 6. RETORNO DE DADOS (Compatibilidade com Frontend)
        profile_list = []
        for i in range(len(df)):
            profile_list.append({
                "pressure": float(df['Pressure'][i]),
                "height": float(df['Altitude'][i]),
                "temp": float(df['Temperature'][i]),
                "dwpt": float(df['Dew_point'][i]),
                "u": float(u_kt[i].m),
                "v": float(v_kt[i].m)
            })

        return {
            "profile": profile_list,
            "parcel": [{"pressure": float(pm), "temp": float(tm - 273.15)} for pm, tm in zip(p.m, parcel_prof.m)],
            "indices": {
                "sbcape": float(sbcape.m), "sbcin": float(sbcin.m),
                "mlcape": float(mlcape.m), "mlcin": float(mlcin.m),
                "mucape": float(mucape.m), "mucin": float(mucin.m),
                "mu_lcl": 0, "mu_lfc": 0, "mu_el": 0, # Placeholder
                "shr0_1km": float(shr1k), "shr0_6km": float(shr6k),
                "srh1km": float(srh1k), "srh3km": float(srh3k),
                "pw": float(pw.m)
            },
            "image": base64_img
        }

    except Exception as e:
        import traceback
        return {"error": f"Internal Rendering Error: {str(e)}", "trace": traceback.format_exc()}
