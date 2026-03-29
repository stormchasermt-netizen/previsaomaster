import pandas as pd
import numpy as np
import io
import sharppy.sharptab.profile as profile
import sharppy.sharptab.params as params
import sharppy.sharptab.winds as winds
from datetime import datetime

def to_f(val):
    """Converte valores do SHARPpy (que podem ser listas ou -9999) para float utilizável."""
    try:
        if isinstance(val, (list, tuple, np.ndarray)):
            v = float(val[0])
        else:
            v = float(val)
        return v if v != -9999.0 and not np.isnan(v) else 0.0
    except:
        return 0.0

def get_study_indices(csv_text):
    """
    Processa um sounding CSV para extrair índices específicos para o Hemisfério Sul.
    Obrigatório: Assume que todo CSV é Latitude < 0 (Hemisfério Sul).
    """
    try:
        # 1. Carregar CSV
        df = pd.read_csv(io.StringIO(csv_text))
        col_map = {
            'Pressure': 'pres', 'pressure': 'pres',
            'Altitude': 'hght', 'altitude': 'hght',
            'Temperature': 'temp', 'temperature': 'temp',
            'Dew_point': 'dwpt', 'dew_point': 'dwpt', 'Dewpoint': 'dwpt',
            'Wind_direction': 'wdir', 'wind_direction': 'wdir',
            'Wind_speed': 'wspd', 'wind_speed': 'wspd',
        }
        df.rename(columns=col_map, inplace=True)
        df = df.dropna(subset=['pres', 'hght', 'temp', 'dwpt', 'wdir', 'wspd'])

        p = df['pres'].astype(float).values
        h = df['hght'].astype(float).values
        t = df['temp'].astype(float).values
        td = df['dwpt'].astype(float).values
        wd = df['wdir'].astype(float).values
        ws = df['wspd'].astype(float).values

        # 2. Criar Perfil SHARPpy (Latitude fixa Sul conforme solicitado)
        lat = -25.0
        prof = profile.create_profile(
            profile='convective',
            pres=p, hght=h, tmpc=t, dwpc=td, wspd=ws, wdir=wd,
            lat=lat, date=datetime.now()
        )

        # 3. Storm Motion (Hemisfério Sul -> Left Mover é a ciclônica)
        # non_parcel_bunkers_motion retorna (r_u, r_v, l_u, l_v)
        _, _, lm_u, lm_v = winds.non_parcel_bunkers_motion(prof)
        
        # 4. Cálculo de SRH (Magnitude absoluta para escala de severidade positiva no SH)
        # Usamos abs() porque helicity() no SH com veering retorna valores negativos
        srh_0_5 = abs(to_f(winds.helicity(prof, 0, 500, lm_u, lm_v)))
        srh_1 = abs(to_f(winds.helicity(prof, 0, 1000, lm_u, lm_v)))
        srh_3 = abs(to_f(winds.helicity(prof, 0, 3000, lm_u, lm_v)))

        # 5. Cálculo de SCP e STP
        mupcl = prof.mupcl
        mlpcl = prof.mlpcl
        
        # SCP: mucape, srh_eff, ebwd magnitude
        ebwd_mag = to_f(prof.ebwd[2]) if isinstance(prof.ebwd, (list, tuple, np.ndarray)) else to_f(prof.ebwd)
        scp = params.scp(to_f(mupcl.bplus), srh_3, ebwd_mag)
        
        # STP Fixed: cape, lcl, srh, shear
        # STP Fixed: stp_fixed(sbcape, sblcl, srh01, bwd6)
        # Assinatura SHARPpy: (sbcape, sblcl, srh01, bwd6)
        # Usamos abs(srh) conforme regra de severidade positiva
        u6, v6 = winds.wind_shear(prof, 0, 6000)
        shear_0_6 = np.sqrt(to_f(u6)**2 + to_f(v6)**2)
        stp = params.stp_fixed(to_f(mlpcl.bplus), to_f(mlpcl.lclhght), srh_1, shear_0_6)

        return {
            'success': True,
            'indices': {
                'stp': float(stp) if not np.isnan(stp) else 0.0,
                'scp': float(scp) if not np.isnan(scp) else 0.0,
                'srh_0_5': float(srh_0_5),
                'srh_1': float(srh_1),
                'srh_3': float(srh_3),
            }
        }
    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e), 'trace': traceback.format_exc()}
