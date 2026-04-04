import pyart
import matplotlib
import colorcet
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import matplotlib.cm as cm
import xarray as xr
from netCDF4 import Dataset
import numpy as np
from datetime import datetime
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from metpy.units import units
from metpy.plots import ctables, Hodograph
import metpy.calc as mpcalc
from xcape.core import calc_srh, calc_cape
from wrf import (to_np, getvar, smooth2d, get_cartopy, cartopy_xlim, interplevel, 
                 cartopy_ylim, latlon_coords, extract_times, ll_to_xy, xy_to_ll)
import glob, os
import cmaps
import matplotlib.patheffects as patheffects
import multiprocessing as mp
from functools import partial
import traceback  # <--- Add this line

# --- Configuration ---
dir_output = '/home/vitor_goede/Build_WRF/WRFV4.7.1/run/'
dir_save = '/home/vitor_goede/wrf_images/' 
listvars = ['mdbz', 'T2m', 'Td_2m', 'Thetae_2m', 'hrt01km', 'hrt03km', 'mucape', 'mlcape', 'sblcl', 'mllr', 'scp', 'stp']

skip = 35

def init_worker():
    """Register colortables in each sub-process."""
    if os.path.exists('/home/vitor_goede/colortable/marco_cape.tbl'):
        try:
            ctables.registry.add_colortable(open('/home/vitor_goede/colortable/marco_cape.tbl', 'rt'), 'cape')
            ctables.registry.add_colortable(open('/home/vitor_goede/colortable/dewpoint2.tbl', 'rt'), 'td')
        except:
            pass

def plot_background(cart_proj, lons, lats):
    fig, ax = plt.subplots(1, 1, figsize=(16, 12), subplot_kw = {'projection': cart_proj})
    ax.set_extent([lons.min()+1.5, lons.max()-2, lats.min()+.3, lats.max()], crs = ccrs.PlateCarree())
    ax.add_feature(cfeature.BORDERS.with_scale('10m'), zorder = 2)
    ax.add_feature(cfeature.COASTLINE.with_scale('10m'), zorder = 3)
    ax.add_feature(cfeature.STATES.with_scale('10m'), linewidth = 0.75, edgecolor = 'k', linestyle='--', zorder = 2)
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

def process_file(file_path):
    try:
        data = Dataset(file_path)
        
        init = datetime.strptime(data.START_DATE, '%Y-%m-%d_%H:%M:%S')
        init_dir, init_dt = init.strftime('%Y%m%d_%H%M%S'), init.strftime('%Y-%m-%d %H:%M:%S')
        vtime = extract_times(data, -1).astype('datetime64[s]').astype(datetime)
        vtime_dir, vtime_dt = vtime.strftime('%Y%m%d_%H%M%S'), vtime.strftime('%Y-%m-%d %H:%M:%S')

        for var in listvars:
            os.makedirs(os.path.join(dir_save, init_dir, var), exist_ok=True)

        # --- Extraction ---
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

        # Unit Quantities
        p_arg = units.Quantity(to_np(Psfc), 'hPa')
        t_arg = units.Quantity(to_np(T_2m), 'degC')
        td_arg = units.Quantity(to_np(Td_2m), 'degC')
        u10_qty = units.Quantity(to_np(u10), 'kt')
        v10_qty = units.Quantity(to_np(v10), 'kt')

        thetae_2m = mpcalc.equivalent_potential_temperature(p_arg, t_arg, td_arg)

        # --- Fix: Unpacking 8 values for SRH ---
        srh_rm_1, srh_lm_1, rm_u, rm_v, lm_u, lm_v, mean_6km_u, mean_6km_v = calc_srh(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(ua).T, to_np(va).T, to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, to_np(ua[0]).T, to_np(va[0]).T, depth=1000, vertical_lev='sigma', output_var='all')
        lm_u_kt = (np.asarray(lm_u) * units('m/s')).to('kt')
        lm_v_kt = (np.asarray(lm_v) * units('m/s')).to('kt')
        
        # --- Fix: Capturing all potential return values for SRH 0-3km ---
        srh_rm_3, srh_lm_3 = calc_srh(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(ua).T, to_np(va).T, 
                            to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, to_np(ua[0]).T, to_np(va[0]).T, 
                            depth=3000, vertical_lev='sigma', output_var='srh')
        
        # --- Fix: Unpacking 4 values for CAPE/CIN ---
        # Change Line 121 to this:
        mcape, mcin, *_ = calc_cape(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, source='most-unstable', vertical_lev='sigma')
        sbcape, sbcin, *_ = calc_cape(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, source='surface', vertical_lev='sigma')
        # Change your MLCAPE line (likely around line 122) to this:
        mlcape, mlcin, *_ = calc_cape(to_np(P).T, to_np(T).T, to_np(Td).T, to_np(P[0]).T, to_np(T[0]).T, to_np(Td[0]).T, source='mixed-layer', ml_depth=1000, vertical_lev='sigma')
        sblcl = 125 * (T_2m - Td_2m)

        # Lapse Rates
        T_500, T_750 = interplevel(T, P, 500), interplevel(T, P, 750)
        z_500, z_750 = interplevel(hgt_agl, P, 500), interplevel(hgt_agl, P, 750)
        lr_700_500 = np.divide(to_np(T_500) - to_np(T_750), to_np(z_500) - to_np(z_750)) * -1e3
        u_500, v_500 = interplevel(ua, P, 500)*units('m/s'), interplevel(va, P, 500)*units('m/s')
        u_700, v_700 = interplevel(ua, P, 700)*units('m/s'), interplevel(va, P, 700)*units('m/s')

        # --- Fix: Separated subtraction to prevent unpacking error ---
        u6_qty = units.Quantity(to_np(interplevel(ua, hgt_agl, 6000)), 'm/s').to('kt')
        v6_qty = units.Quantity(to_np(interplevel(va, hgt_agl, 6000)), 'm/s').to('kt')
        u_shear_06 = u6_qty - u10_qty
        v_shear_06 = v6_qty - v10_qty

        u1_qty = units.Quantity(to_np(interplevel(ua, hgt_agl, 1000)), 'm/s').to('kt')
        v1_qty = units.Quantity(to_np(interplevel(va, hgt_agl, 1000)), 'm/s').to('kt')
        u_shear_01 = u1_qty - u10_qty
        v_shear_01 = v1_qty - v10_qty

        scp = (mcape/1000)*(srh_lm_3/50)*(mpcalc.wind_speed(u_shear_06, v_shear_06)/40)
        stp = (sbcape/1500)*((2000-sblcl)/1000)*(srh_lm_1/150)*(mpcalc.wind_speed(u_shear_06, v_shear_06)/40)*((200-sbcin)/150)

        cape_levels = [0, 100, 200, 350, 500, 750, 1000, 1300, 1600, 2000, 2400, 2800, 3300, 3800, 4400, 5000]
        cape_norm, cape_cmap = ctables.registry.get_with_boundaries('cape', cape_levels)
        td_cmap = ctables.registry.get_colortable('td')

        # --- Plotting Block ---
        # Plot 1: MDBZ
        fig, ax = plot_background(cart_proj, lons, lats)
        dbz = ax.contourf(to_np(lons), to_np(lats), to_np(max_dbz), transform=ccrs.PlateCarree(), cmap=pyart.graph.cmweather.cm.LangRainbow12, levels=np.arange(5, 77.5, 2.5), extend='max')
        ax.contour(to_np(lons), to_np(lats), to_np(uhel), levels=[-50], colors='purple', transform=ccrs.PlateCarree())
        fig.colorbar(dbz, ax=ax, ticks=np.arange(0, 80, 5))
        plt.title(f'Max dBZ | UH < -50 \nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/mdbz/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 2: T2m
        fig, ax = plot_background(cart_proj, lons, lats)
        t2_plt = ax.contourf(to_np(lons), to_np(lats), to_np(T_2m), transform=ccrs.PlateCarree(), cmap=cmaps.NCV_bright, levels=np.arange(-10, 41, 1), extend='both')
        ps_plt = ax.contour(to_np(lons), to_np(lats), smooth2d(Psfc, passes=1), levels=np.arange(900, 1100, 2), transform=ccrs.PlateCarree(), colors='k', linewidths=0.8)
        ax.clabel(ps_plt, inline=True, fmt='%0.0f')
        barbs = ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u10[::skip, ::skip]), to_np(v10[::skip, ::skip]), transform=ccrs.PlateCarree(), length=6, flip_barb=True)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        fig.colorbar(t2_plt, ax=ax, ticks=np.arange(-10, 45, 5))
        plt.title(r'Temperatura a 2m [$^\circ$C] | Vento a 10m [kt] | PNMM [hPa]' + '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/T2m/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 3: Td 2m
        fig, ax = plot_background(cart_proj, lons, lats)
        td_plt = ax.contourf(to_np(lons), to_np(lats), to_np(td_arg.m), transform=ccrs.PlateCarree(), cmap=td_cmap, levels=np.arange(-40, 31, 1), extend='both')
        fig.colorbar(td_plt, ax=ax, ticks=np.arange(-40, 35, 5))
        barbs = ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u10[::skip, ::skip]), to_np(v10[::skip, ::skip]), transform=ccrs.PlateCarree(), length=6, flip_barb=True)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        plt.title(r'Ponto de Orvalho a 2m [$^\circ$C] | Vento 10m [kt] | PNMM [hPa]' + '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/Td_2m/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 4: Theta-e
        fig, ax = plot_background(cart_proj, lons, lats)
        eth_plt = ax.contourf(to_np(lons), to_np(lats), to_np(thetae_2m), transform=ccrs.PlateCarree(), cmap=cmaps.BkBlAqGrYeOrReViWh200, levels=np.arange(250, 382.5, 2.5), extend='both')
        barbs = ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u10[::skip, ::skip]), to_np(v10[::skip, ::skip]), transform=ccrs.PlateCarree(), length=6, flip_barb = True)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        fig.colorbar(eth_plt, ax=ax, ticks=np.arange(250, 390, 10))
        plt.title(r'$\theta_e$ a 2 m [K] | Vento a 10 m [kt] | PNMM [hPa]' + '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/Thetae_2m/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 5: SRH 0-1km
        fig, ax = plot_background(cart_proj, lons, lats)
        srh1_plt = ax.contourf(to_np(lons).T, to_np(lats).T, to_np(srh_lm_1), transform=ccrs.PlateCarree(), levels=np.arange(-500, -40, 10), cmap=cmaps.GMT_seis, extend='min')
        fig.colorbar(srh1_plt, ax=ax, ticks=np.arange(-500, -40, 50))
        barbs = ax.barbs(to_np(lons[::skip, ::skip]).T, to_np(lats[::skip, ::skip]).T, lm_u_kt[::skip, ::skip].m, lm_v_kt[::skip, ::skip].m, length=6, transform=ccrs.PlateCarree(), flip_barb=True)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        plt.title(r'HRT 0-1 km [m$^2$/s$^2$] | Vetor Deslocamento a Esquerda (Bunkers) [kt]' + '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/hrt01km/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 6: SRH 0-3km
        fig, ax = plot_background(cart_proj, lons, lats)
        srh3_plt = ax.contourf(to_np(lons).T, to_np(lats).T, to_np(srh_lm_3), transform=ccrs.PlateCarree(), levels=np.arange(-700, -40, 10), cmap=cmaps.GMT_seis, extend='min')
        fig.colorbar(srh3_plt, ax=ax, ticks=np.arange(-700, -40, 50))
        barbs = ax.barbs(to_np(lons[::skip, ::skip]).T, to_np(lats[::skip, ::skip]).T, lm_u_kt[::skip, ::skip].m, lm_v_kt[::skip, ::skip].m, length=6, transform=ccrs.PlateCarree(), flip_barb=True)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        plt.title(r'HRT 0-3 km [m$^2$/s$^2$] | Vetor Deslocamento a Esquerda (Bunkers) [kt]' + '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/hrt03km/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 7: MUCAPE
        fig, ax = plot_background(cart_proj, lons, lats)
        mu_plt = ax.contourf(to_np(lons).T, to_np(lats).T, mcape, transform=ccrs.PlateCarree(), levels=cape_levels, cmap=cape_cmap, norm=cape_norm, extend='max')
        fig.colorbar(mu_plt, ax=ax, ticks=cape_levels, extend='max')
        ax.contourf(to_np(lons).T, to_np(lats).T, mcin, levels=[30, 50, 75, 100, 150, 300], cmap='Greys', hatches=['--'], alpha=0.5, extend='max', transform=ccrs.PlateCarree())
        hodomap(data, lons, lats, ua, va, P, hgt_agl, ax, step=52)
        plt.title('MUCAPE [J/kg] | Horodgrafa de 0-10 km' + '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/mucape/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 8: MLCAPE
        fig, ax = plot_background(cart_proj, lons, lats)
        ml_plt = ax.contourf(to_np(lons).T, to_np(lats).T, to_np(mlcape), transform=ccrs.PlateCarree(), levels=cape_levels, cmap=cape_cmap, norm=cape_norm, extend='max')
        fig.colorbar(ml_plt, ax=ax, ticks=cape_levels, extend='max')
        ax.contourf(to_np(lons).T, to_np(lats).T, to_np(mlcin), levels=[30, 50, 75, 100, 150, 300], cmap='Greys', hatches=['--'], alpha=0.5, extend='max', transform=ccrs.PlateCarree())
        barbs = ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u_shear_06[::skip, ::skip].m), to_np(v_shear_06[::skip, ::skip].m), transform=ccrs.PlateCarree(), barbcolor='w', length=6, flip_barb=True)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='k')])
        plt.title('0-100 mb MLCAPE [J/kg] | 0-100 mb MLCIN < -30 [J/kg] | BWD 0-6 km [kt]'+ '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/mlcape/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 9: SBLCL
        fig, ax = plot_background(cart_proj, lons, lats)
        lcl_plt = ax.contourf(to_np(lons), to_np(lats), to_np(sblcl), transform=ccrs.PlateCarree(), levels=np.arange(0, 5100, 100), cmap=cmaps.WhiteBlueGreenYellowRed, extend='max')
        fig.colorbar(lcl_plt, ax=ax, ticks=np.arange(0, 5100, 500))
        barbs = ax.barbs(to_np(lons[::skip,::skip]), to_np(lats[::skip,::skip]), to_np(u_shear_01[::skip, ::skip].m), to_np(v_shear_01[::skip, ::skip].m), transform=ccrs.PlateCarree(), length=6, flip_barb=True)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        plt.title('SBLCL [m] | BWD 0-1 km [kt]' + '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/sblcl/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 10: MLLR
        fig, ax = plot_background(cart_proj, lons, lats)
        lr_plt = ax.contourf(to_np(lons), to_np(lats), lr_700_500, cmap='YlOrRd', levels=np.arange(5.5, 9.6, 0.1), extend='max', transform=ccrs.PlateCarree())
        fig.colorbar(lr_plt, ax=ax, ticks=np.arange(5.5, 10, 0.5))
        lrc = ax.contour(to_np(lons), to_np(lats), lr_700_500, colors='black', levels=np.arange(5.5, 10.0, 1), transform=ccrs.PlateCarree(), linewidths=0.75)
        ax.clabel(lrc, inline=True, fmt='%0.1f')
        barbs = ax.barbs(to_np(lons[::skip, ::skip]), to_np(lats[::skip, ::skip]), to_np(u_500[::skip, ::skip]), to_np(v_500[::skip, ::skip]), length=6, transform=ccrs.PlateCarree(), flip_barb=True)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        barbs = ax.barbs(to_np(lons[::skip, ::skip]), to_np(lats[::skip, ::skip]), to_np(u_700[::skip, ::skip]), to_np(v_700[::skip, ::skip]), length=6, barbcolor = 'blue', transform=ccrs.PlateCarree(), flip_barb=True)
        barbs = barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        plt.title(r'Lapse Rate 700-500 hPa [$^\circ$C/km]' + '\nWRF PREVOTS 3 km', loc='left')
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/mllr/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 11: SCP
        fig, ax = plot_background(cart_proj, lons, lats)
        scp_fix = ax.contourf(to_np(lons), to_np(lats), scp, transform=ccrs.PlateCarree(), levels = np.arange(-30, 0, 0.1), cmap = 'cet_CET_R1_r', extend = 'min')
        barbs = ax.barbs(to_np(lons[::skip, ::skip]).T, to_np(lats[::skip, ::skip]).T, lm_u_kt[::skip, ::skip].m, lm_v_kt[::skip, ::skip].m, length = 6, transform = ccrs.PlateCarree(), flip_barb = True, zorder = 5)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        plt.title(r'SCP | Vetor Deslocamento a Esquerda (Bunkers) [kt]' + '\nWRF PREVOTS 3 km', loc='left')
        fig.colorbar(scp_fix, ticks = np.arange(-30, 2, 2), ax = ax)
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/scp/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        # Plot 11: STP
        fig, ax = plot_background(cart_proj, lons, lats)
        stp_fix = ax.contourf(to_np(lons), to_np(lats), stp, transform=ccrs.PlateCarree(), levels = np.arange(-10, 0, 0.1), cmap = 'cet_CET_R1_r', extend = 'min')
        barbs = ax.barbs(to_np(lons[::skip, ::skip]).T, to_np(lats[::skip, ::skip]).T, lm_u_kt[::skip, ::skip].m, lm_v_kt[::skip, ::skip].m, length = 6, transform = ccrs.PlateCarree(), flip_barb = True, zorder = 5)
        barbs.set_path_effects([patheffects.withStroke(linewidth=2, foreground='w')])
        plt.title(r'STP | Vetor Deslocamento a Esquerda (Bunkers) [kt]' + '\nWRF PREVOTS 3 km', loc='left')
        fig.colorbar(stp_fix, ticks = np.arange(-11, 0, 1), ax = ax)
        plt.title(f'Inic.: {init_dt} UTC\n Val.: {vtime_dt} UTC', loc='right')
        plt.savefig(f'{dir_save}/{init_dir}/stp/{vtime_dir}.jpg', bbox_inches='tight', dpi=200)
        plt.close(fig)

        data.close()
        print(f"Success: {vtime_dir}")
        return True
    except Exception as e:
        # This will print the full traceback including the line number
        print(f"Error in {file_path}:")
        traceback.print_exc() 
        return False

if __name__ == "__main__":
    files = sorted(glob.glob(dir_output + 'wrfout*'))
    num_cpus = mp.cpu_count()
    print(f"Starting parallel plot for {len(files)} files using {num_cpus} CPUs")
    
    with mp.Pool(processes=num_cpus, initializer=init_worker) as pool:
        pool.map(process_file, files)
