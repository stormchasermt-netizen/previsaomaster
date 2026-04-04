import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from netCDF4 import Dataset
import gzip
import numpy as np
from datetime import datetime
import glob, os, traceback
import multiprocessing as mp
import cmaps
from metpy.units import units
from metpy.plots import ctables, Hodograph
import metpy.calc as mpcalc
from xcape.core import calc_srh, calc_cape
from wrf import (to_np, getvar, smooth2d, get_cartopy, interplevel, 
                 latlon_coords, extract_times, ll_to_xy, xy_to_ll)

# --- Configurações Principais ---
dir_output = '/home/vitor_goede/Build_WRF/WRFV4.7.1/run/'
dir_save = '/home/vitor_goede/wrf_images/' 
listvars = ['mdbz', 'T2m', 'Td_2m', 'Thetae_2m', 'hrt01km', 'hrt03km', 'mucape', 'mlcape', 'sblcl', 'mllr']

# --- AJUSTES DE ESCALA PARA O DOMÍNIO DO PARANÁ (dx=6km) ---
skip = 15      # Densidade das setas de vento (1 seta a cada 30km)
hodo_step = 15 # Densidade dos hodógrafos (1 gráfico a cada 90km)

def init_worker():
    """Registra as tabelas de cores em cada processador"""
    try:
        if os.path.exists('/home/vitor_goede/colortable/marco_cape.tbl'):
            ctables.registry.add_colortable(open('/home/vitor_goede/colortable/marco_cape.tbl', 'rt'), 'cape')
            ctables.registry.add_colortable(open('/home/vitor_goede/colortable/dewpoint2.tbl', 'rt'), 'td')
    except:
        pass

def plot_background(cart_proj, lons, lats):
    fig, ax = plt.subplots(1, 1, figsize=(16, 12), subplot_kw={'projection': cart_proj})
    
    # Zoom forçado no Paraná [Oeste, Leste, Sul, Norte]
    ax.set_extent([-56.0, -47.0, -27.0, -22.0], crs=ccrs.PlateCarree())

    ax.add_feature(cfeature.BORDERS.with_scale('10m'), zorder=2)
    ax.add_feature(cfeature.COASTLINE.with_scale('10m'), zorder=3)
    ax.add_feature(cfeature.STATES.with_scale('10m'), linewidth=0.75, edgecolor='k', zorder=2)
    return fig, ax

def hodomap(data, lon_array, lat_array, u, v, P, hgt, ax, step):
    x_0, y_0 = ll_to_xy(data, longitude=lon_array[::step, ::step], latitude=lat_array[::step, ::step], timeidx=0)
    u_np, v_np, z_np, p_np = to_np(u), to_np(v), to_np(hgt), to_np(P)
      
    for a, b in zip(x_0, y_0):
        p_snd = units.Quantity(p_np[:, b, a], 'hPa')
        u_snd = units.Quantity(u_np[:, b, a], 'm/s').to('kt')
        v_snd = units.Quantity(v_np[:, b, a], 'm/s').to('kt')
        z_snd = units.Quantity(z_np[:, b, a], 'm')
        
        _, lm, _ = mpcalc.bunkers_storm_motion(p_snd, u_snd, v_snd, z_snd)
        mask = z_snd <= units.Quantity(10000, 'm')
    
        lat_0, lon_0 = xy_to_ll(data, a, b, timeidx=0)
        x_lamb, y_lamb = ax.projection.transform_point(lon_0, lat_0, ccrs.PlateCarree())
        x_disp, y_disp = ax.transData.transform((x_lamb, y_lamb))
        x_axes, y_axes = ax.transAxes.inverted().transform((x_disp, y_disp))

        ax_hodo = ax.inset_axes([x_axes, y_axes, 0.08, 0.08], transform=ax.transAxes)
        ax_hodo.set_axis_off()
        h = Hodograph(ax_hodo, component_range=80)
        h.add_grid(increment=40, color='k', lw=0.5, alpha=0.5)
        h.plot_colormapped(u_snd[mask], v_snd[mask], z_snd[mask], 
                           intervals=np.array([0, 1000, 3000, 6000, 10000]) * units.m, 
                           colors=['violet', 'r', 'lime', 'b'])
        h.plot(lm[0], lm[1], marker='o', color='k', markersize=3)

def salvar_matriz_gz(dados, caminho_base_jpg):
    try:
        # caminho_base_jpg é algo como: "pasta/mlcape/2026-04-01_12:00:00.jpg"
        # Substituímos .jpg por .npy.gz
        caminho_gz = caminho_base_jpg.replace('.jpg', '.npy.gz')
        
        # 1. Tenta tirar a unidade se for diretamente um Pint Quantity (MetPy)
        if hasattr(dados, 'm'):
            dados_brutos = dados.m
        # 2. Tenta tirar a unidade Pint se for um xarray DataArray com unidades
        elif hasattr(dados, 'data') and hasattr(dados.data, 'm'):
            dados_brutos = dados.data.m
        # 3. Tenta usar o to_np do wrf-python que já limpa meta-dados
        elif hasattr(dados, 'values'):
            try:
                dados_brutos = to_np(dados)
            except:
                dados_brutos = dados.values
        # 4. Fallback final
        else:
            dados_brutos = dados
            
        # Extrai só a matriz de números, arredonda para 1 casa decimal e converte para float16
        dados_puros = np.round(np.asarray(dados_brutos, dtype=np.float32), 1).astype(np.float16)
        
        # Salva compactado
        with gzip.GzipFile(caminho_gz, "w") as f:
            np.save(f, dados_puros)
    except Exception as e:
        print(f"Erro ao salvar GZ para {caminho_base_jpg}: {e}")

def process_file(file_path):
    try:
        data = Dataset(file_path)
        
        init = datetime.strptime(data.START_DATE, '%Y-%m-%d_%H:%M:%S')
        # Cria a pasta com o nome específico do Paraná
        init_dir = init.strftime('%Y%m%d') + '_parana_' + init.strftime('%H%M%S')
        
        vtime = extract_times(data, -1).astype('datetime64[s]').astype(datetime)
        vtime_dir, vtime_dt = vtime.strftime('%Y%m%d_%H%M%S'), vtime.strftime('%Y-%m-%d %H:%M:%S')

        for var in listvars:
            os.makedirs(os.path.join(dir_save, init_dir, var), exist_ok=True)

        max_dbz = getvar(data, 'mdbz', timeidx=-1)
        uhel = getvar(data, 'UP_HELI_MAX', timeidx=-1)
        lats, lons = latlon_coords(max_dbz)
        cart_proj = get_cartopy(max_dbz)
        
        P, T = getvar(data, 'pressure', timeidx=-1), getvar(data, 'tc', timeidx=-1)
        hgt_agl = getvar(data, 'height_agl', timeidx=-1, units='m')
        Td = getvar(data, 'td', timeidx=-1, units='degC')
        Psfc = getvar(data, 'slp', timeidx=-1, units='mb')
        T_2m = getvar(data, 'T2', timeidx=-1) - 273.15
        Td_2m = getvar(data, 'td2', timeidx=-1, units='degC')
        u10, v10 = getvar(data, 'uvmet10', timeidx=-1, units='kt')
        ua, va = getvar(data, 'uvmet', timeidx=-1, units='m/s')

        p_arg = units.Quantity(to_np(Psfc), 'hPa')
        t_arg = units.Quantity(to_np(T_2m), 'degC')
        td_arg = units.Quantity(to_np(Td_2m), 'degC')
        u10_qty = units.Quantity(to_np(u10), 'kt')
        v10_qty = units.Quantity(to_np(v10), 'kt')

        thetae_2m = mpcalc.equivalent_potential_temperature(p_arg, t_arg, td_arg)

        srh_rm_1, srh_lm_1, *_ = calc_srh(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(ua).T, to_np(va).T, 
                                          to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, to_np(ua[0]).T, to_np(va[0]).T, 
                                          depth=1000, vertical_lev='sigma', output_var='all')
        
        lm_u, lm_v = _[2], _[3] 
        lm_u_kt = (np.asarray(lm_u) * units('m/s')).to('kt')
        lm_v_kt = (np.asarray(lm_v) * units('m/s')).to('kt')
        
        srh_rm_3, srh_lm_3, *_ = calc_srh(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(ua).T, to_np(va).T, 
                                          to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, to_np(ua[0]).T, to_np(va[0]).T, 
                                          depth=3000, vertical_lev='sigma', output_var='srh')
        
        mcape, mcin, *_ = calc_cape(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, source='most-unstable', vertical_lev='sigma')
        mlcape, mlcin, *_ = calc_cape(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, source='mixed-layer', ml_depth=1000, vertical_lev='sigma')
        
        sblcl = 125 * (T_2m - Td_2m)

        T_500, T_750 = interplevel(T, P, 500), interplevel(T, P, 750)
        z_500, z_750 = interplevel(hgt_agl, P, 500), interplevel(hgt_agl, P, 750)
        lr_700_500 = np.divide(to_np(T_500) - to_np(T_750), to_np(z_500) - to_np(z_750)) * -1e3
        
        u_500, v_500 = interplevel(ua, P, 500)*units('m/s'), interplevel(va, P, 500)*units('m/s')
        u_700, v_700 = interplevel(ua, P, 700)*units('m/s'), interplevel(va, P, 700)*units('m/s')

        u6_qty = units.Quantity(to_np(interplevel(ua, hgt_agl, 6000)), 'm/s').to('kt')
        v6_qty = units.Quantity(to_np(interplevel(va, hgt_agl, 6000)), 'm/s').to('kt')
        u_shear_06 = u6_qty - u10_qty
        v_shear_06 = v6_qty - v10_qty

        u1_qty = units.Quantity(to_np(interplevel(ua, hgt_agl, 1000)), 'm/s').to('kt')
        v1_qty = units.Quantity(to_np(interplevel(va, hgt_agl, 1000)), 'm/s').to('kt')
        u_shear_01 = u1_qty - u10_qty
        v_shear_01 = v1_qty - v10_qty

        cape_levels = [0, 100, 200, 350, 500, 750, 1000, 1300, 1600, 2000, 2400, 2800, 3300, 3800, 4400, 5000]
        cape_norm, cape_cmap = ctables.registry.get_with_boundaries('cape', cape_levels)
        td_cmap = ctables.registry.get_colortable('td')

        fig, ax = plot_background(cart_proj, lons, lats)
        dbz = ax.contourf(to_np(lons), to_np(lats), to_np(max_dbz), transform=ccrs.PlateCarree(), cmap='gist_ncar', levels=np.arange(5, 77.5, 2.5), extend='max')
        ax.contour(to_np(lons), to_np(lats), to_np(uhel), levels=[-50], colors='purple', transform=ccrs.PlateCarree())
        fig.colorbar(dbz, ax=ax, ticks=np.arange(0, 80, 5))
        plt.title(f'Max dBZ | UH < -50 | {vtime_dt} UTC', loc='left')
        caminho_salvar_mdbz = f'{dir_save}/{init_dir}/mdbz/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_mdbz, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(max_dbz, caminho_salvar_mdbz)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        t2_plt = ax.contourf(to_np(lons), to_np(lats), to_np(T_2m), transform=ccrs.PlateCarree(), cmap=cmaps.NCV_bright, levels=np.arange(-10, 41, 1), extend='both')
        ps_plt = ax.contour(to_np(lons), to_np(lats), smooth2d(Psfc, passes=1), levels=np.arange(900, 1100, 2), transform=ccrs.PlateCarree(), colors='k', linewidths=0.8)
        ax.clabel(ps_plt, inline=True, fmt='%0.0f')
        ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u10[::skip, ::skip]), to_np(v10[::skip, ::skip]), transform=ccrs.PlateCarree(), length=6.5, flip_barb=True)
        fig.colorbar(t2_plt, ax=ax, ticks=np.arange(-10, 45, 5))
        plt.title(f'T 2m [C] | Vento 10m [kt] | PNMM [hPa]', loc='left')
        caminho_salvar_T2m = f'{dir_save}/{init_dir}/T2m/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_T2m, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(T_2m, caminho_salvar_T2m)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        td_plt = ax.contourf(to_np(lons), to_np(lats), to_np(td_arg.m), transform=ccrs.PlateCarree(), cmap=td_cmap, levels=np.arange(-40, 31, 1), extend='both')
        fig.colorbar(td_plt, ax=ax, ticks=np.arange(-40, 35, 5))
        ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u10[::skip, ::skip]), to_np(v10[::skip, ::skip]), transform=ccrs.PlateCarree(), length=7, flip_barb=True)
        plt.title('Dewpoint 2m [C] | Wind 10m [kt]', loc='left')
        caminho_salvar_Td_2m = f'{dir_save}/{init_dir}/Td_2m/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_Td_2m, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(td_arg.m, caminho_salvar_Td_2m)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        eth_plt = ax.contourf(to_np(lons), to_np(lats), to_np(thetae_2m), transform=ccrs.PlateCarree(), cmap=cmaps.BkBlAqGrYeOrReViWh200, levels=np.arange(250, 382.5, 2.5), extend='both')
        ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u10[::skip, ::skip]), to_np(v10[::skip, ::skip]), transform=ccrs.PlateCarree(), length=7, flip_barb = True)
        fig.colorbar(eth_plt, ax=ax, ticks=np.arange(250, 390, 10))
        plt.title(r'Theta_e a 2 m [K] | Vento 10 m [kt]', loc='left')
        caminho_salvar_Thetae_2m = f'{dir_save}/{init_dir}/Thetae_2m/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_Thetae_2m, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(thetae_2m, caminho_salvar_Thetae_2m)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        srh1_plt = ax.contourf(to_np(lons).T, to_np(lats).T, to_np(srh_lm_1), transform=ccrs.PlateCarree(), levels=np.arange(-500, -40, 10), cmap=cmaps.GMT_seis, extend='min')
        fig.colorbar(srh1_plt, ax=ax, ticks=np.arange(-500, -40, 50))
        ax.barbs(to_np(lons[::skip, ::skip]).T, to_np(lats[::skip, ::skip]).T, lm_u_kt[::skip, ::skip].m, lm_v_kt[::skip, ::skip].m, length=7, transform=ccrs.PlateCarree(), flip_barb=True)
        plt.title('0-1 km SRH [m2/s2] | Left-Mover Vectors [kt]', loc='left')
        caminho_salvar_hrt01km = f'{dir_save}/{init_dir}/hrt01km/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_hrt01km, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(srh_lm_1, caminho_salvar_hrt01km)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        srh3_plt = ax.contourf(to_np(lons).T, to_np(lats).T, to_np(srh_lm_3), transform=ccrs.PlateCarree(), levels=np.arange(-700, -40, 10), cmap=cmaps.GMT_seis, extend='min')
        fig.colorbar(srh3_plt, ax=ax, ticks=np.arange(-700, -40, 50))
        ax.barbs(to_np(lons[::skip, ::skip]).T, to_np(lats[::skip, ::skip]).T, lm_u_kt[::skip, ::skip].m, lm_v_kt[::skip, ::skip].m, length=7, transform=ccrs.PlateCarree(), flip_barb=True)
        plt.title('0-3 km SRH [m2/s2] | Left-Mover Vectors [kt]', loc='left')
        caminho_salvar_hrt03km = f'{dir_save}/{init_dir}/hrt03km/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_hrt03km, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(srh_lm_3, caminho_salvar_hrt03km)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        mu_plt = ax.contourf(to_np(lons).T, to_np(lats).T, mcape, transform=ccrs.PlateCarree(), levels=cape_levels, cmap=cape_cmap, norm=cape_norm, extend='max')
        fig.colorbar(mu_plt, ax=ax, ticks=cape_levels, extend='max')
        ax.contourf(to_np(lons).T, to_np(lats).T, mcin, levels=[30, 50, 75, 100, 150, 300], cmap='Greys', hatches=['--'], alpha=0.5, extend='max', transform=ccrs.PlateCarree())
        hodomap(data, lons, lats, ua, va, P, hgt_agl, ax, step=hodo_step)
        plt.title('MUCAPE [J/kg] | 0-10 km SR Hodographs', loc='left')
        caminho_salvar_mucape = f'{dir_save}/{init_dir}/mucape/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_mucape, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(mcape, caminho_salvar_mucape)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        ml_plt = ax.contourf(to_np(lons).T, to_np(lats).T, to_np(mlcape), transform=ccrs.PlateCarree(), levels=cape_levels, cmap=cape_cmap, norm=cape_norm, extend='max')
        fig.colorbar(ml_plt, ax=ax, ticks=cape_levels, extend='max')
        ax.contourf(to_np(lons).T, to_np(lats).T, to_np(mlcin), levels=[30, 50, 75, 100, 150, 300], cmap='Greys', hatches=['--'], alpha=0.5, extend='max', transform=ccrs.PlateCarree())
        ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u_shear_06[::skip, ::skip].m), to_np(v_shear_06[::skip, ::skip].m), transform=ccrs.PlateCarree(), barbcolor='k', length=7, flip_barb=True)
        plt.title('MLCAPE [J/kg] | MLCIN < -30 | BWD 0-6 km [kt]', loc='left')
        caminho_salvar_mlcape = f'{dir_save}/{init_dir}/mlcape/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_mlcape, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(mlcape, caminho_salvar_mlcape)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        lcl_plt = ax.contourf(to_np(lons), to_np(lats), to_np(sblcl), transform=ccrs.PlateCarree(), levels=np.arange(0, 5100, 100), cmap=cmaps.WhiteBlueGreenYellowRed, extend='max')
        fig.colorbar(lcl_plt, ax=ax, ticks=np.arange(0, 5100, 500))
        ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u_shear_01[::skip, ::skip].m), to_np(v_shear_01[::skip, ::skip].m), transform=ccrs.PlateCarree(), length=7, flip_barb=True)
        plt.title('SBLCL [m] | BWD 0-1 km [kt]', loc='left')
        caminho_salvar_sblcl = f'{dir_save}/{init_dir}/sblcl/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_sblcl, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(sblcl, caminho_salvar_sblcl)
        plt.close(fig)

        fig, ax = plot_background(cart_proj, lons, lats)
        lr_plt = ax.contourf(to_np(lons), to_np(lats), lr_700_500, cmap='YlOrRd', levels=np.arange(5.5, 9.6, 0.1), extend='max', transform=ccrs.PlateCarree())
        fig.colorbar(lr_plt, ax=ax, ticks=np.arange(5.5, 10, 0.5))
        lrc = ax.contour(to_np(lons), to_np(lats), lr_700_500, colors='black', levels=np.arange(5.5, 10.0, 1), transform=ccrs.PlateCarree(), linewidths=0.75)
        ax.clabel(lrc, inline=True, fmt='%0.1f')
        ax.barbs(to_np(lons[::skip, ::skip]), to_np(lats[::skip, ::skip]), to_np(u_500[::skip, ::skip]), to_np(v_500[::skip, ::skip]), length=7, transform=ccrs.PlateCarree(), flip_barb=True)
        ax.barbs(to_np(lons[::skip, ::skip]), to_np(lats[::skip, ::skip]), to_np(u_700[::skip, ::skip]), to_np(v_700[::skip, ::skip]), length=7, barbcolor = 'blue', transform=ccrs.PlateCarree(), flip_barb=True)
        caminho_salvar_mllr = f'{dir_save}/{init_dir}/mllr/{vtime_dir}.jpg'
        plt.savefig(caminho_salvar_mllr, bbox_inches='tight', dpi=200)
        salvar_matriz_gz(lr_700_500, caminho_salvar_mllr)
        plt.close(fig)

        data.close()
        print(f"Sucesso: {vtime_dir}")
        return True
    except Exception as e:
        print(f"Erro no arquivo {file_path}:")
        traceback.print_exc() 
        return False

if __name__ == "__main__":
    files = sorted(glob.glob(dir_output + 'wrfout*'))
    num_cpus = mp.cpu_count()
    print(f"==================================================")
    print(f" INICIANDO PLOTAGEM DO PARANÁ (Potência Máxima) ")
    print(f" Processadores alocados: {num_cpus}")
    print(f" Arquivos na fila: {len(files)}")
    print(f"==================================================")
    
    with mp.Pool(processes=num_cpus, initializer=init_worker) as pool:
        pool.map(process_file, files)
