#!/usr/bin/env python3
"""
Renderiza sounding estilo SHARPpy/SPC usando o módulo oficial sharppy.plot.skew (Matplotlib).
Não usa Qt — funciona sem xvfb (ideal para VM headless e Cloud Run).

O antigo `sharppy.viz.spc` / SPCWindo foi removido do upstream SHARPpy; ver examples/plot_sounding.py no repo oficial.
"""
from __future__ import annotations

import os
import sys
import warnings

warnings.filterwarnings("ignore")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import gridspec
from matplotlib.patches import Circle
from matplotlib.ticker import ScalarFormatter, MultipleLocator
import numpy as np
import pandas as pd

import sharppy.plot.skew as skew
import sharppy.sharptab.profile as profile
import sharppy.sharptab.params as params
import sharppy.sharptab.winds as winds
import sharppy.sharptab.utils as utils
import sharppy.sharptab.interp as interp


def _draw_hodo_inset(ax):
    """Hodógrafo em inset (axes_grid antigo do skew pode falhar no Matplotlib 3.x)."""
    try:
        from mpl_toolkits.axes_grid1.inset_locator import inset_axes as make_inset
    except ImportError:
        from mpl_toolkits.axes_grid.inset_locator import inset_axes as make_inset

    iax = make_inset(ax, width=1.7, height=1.7, loc=1)
    iax.get_xaxis().set_visible(False)
    iax.get_yaxis().set_visible(False)
    for i in range(10, 90, 10):
        circle = Circle((0, 0), i, color="k", alpha=0.3, fill=False)
        if i % 10 == 0 and i <= 50:
            iax.text(-i, 2, str(i), fontsize=8, horizontalalignment="center")
        iax.add_artist(circle)
    iax.set_xlim(-60, 60)
    iax.set_ylim(-60, 60)
    iax.axhline(y=0, color="k")
    iax.axvline(x=0, color="k")
    return iax


def _latitude() -> float:
    v = os.environ.get("SOUNDING_LATITUDE", "-23.5")
    try:
        return float(v)
    except ValueError:
        return -23.5


def _plot_wind_barbs(axes, p, u, v, flip_barb: bool):
    """Igual a skew.plot_wind_barbs, com flip para hemisfério sul (convenção WMO)."""
    pb = skew.pb_plot
    pt = skew.pt_plot
    for i in np.arange(0, len(p)):
        if p[i] > pt:
            if np.ma.is_masked(v[i]):
                continue
            axes.barbs(
                0,
                p[i],
                u[i],
                v[i],
                length=7,
                clip_on=False,
                linewidth=1,
                flip_barb=flip_barb,
            )


def run_renderer(csv_path: str, output_path: str) -> None:
    df = pd.read_csv(csv_path)
    p = df["pres"].values
    z = df["hght"].values
    t = df["temp"].values
    td = df["dwpt"].values
    wd = df["wdir"].values
    ws = df["wspd"].values

    lat = _latitude()
    prof = profile.create_profile(
        profile="convective",
        pres=p,
        hght=z,
        tmpc=t,
        dwpc=td,
        wspd=ws,
        wdir=wd,
        missing=-9999,
        latitude=lat,
    )

    title_txt = f"SHARPpy skew (lat={lat:.2f})"

    fig = plt.figure(figsize=(9, 8))
    gs = gridspec.GridSpec(4, 4, width_ratios=[1, 5, 1, 1])
    ax = plt.subplot(gs[0:3, 0:2], projection="skewx")
    skew.draw_title(ax, title_txt)
    ax.grid(True)

    ax.semilogy(prof.tmpc[~prof.tmpc.mask], prof.pres[~prof.tmpc.mask], "r", lw=2)
    ax.semilogy(prof.dwpc[~prof.dwpc.mask], prof.pres[~prof.dwpc.mask], "g", lw=2)
    try:
        ax.semilogy(prof.vtmp[~prof.dwpc.mask], prof.pres[~prof.dwpc.mask], "r--")
        ax.semilogy(prof.wetbulb[~prof.dwpc.mask], prof.pres[~prof.dwpc.mask], "c-")
    except Exception:
        pass
    try:
        ax.semilogy(prof.mupcl.ttrace, prof.mupcl.ptrace, "k--")
    except Exception:
        pass

    ax.axvline(0, color="b", ls="--")
    ax.axvline(-20, color="b", ls="--")
    ax.yaxis.set_major_formatter(ScalarFormatter())
    ax.set_yticks(np.linspace(100, 1000, 10))
    ax.set_ylim(1050, 100)

    hodo_ax = _draw_hodo_inset(ax)
    skew.plotHodo(hodo_ax, prof.hght, prof.u, prof.v, color="r")

    ax.xaxis.set_major_locator(MultipleLocator(10))
    ax.set_xlim(-50, 50)

    ax2 = plt.subplot(gs[0:3, 2])
    skew.plot_wind_axes(ax2)
    flip = lat < 0
    _plot_wind_barbs(ax2, prof.pres, prof.u, prof.v, flip_barb=flip)

    srwind = params.bunkers_storm_motion(prof)
    ax3 = plt.subplot(gs[3, 0:3])

    p1km = interp.pres(prof, interp.to_msl(prof, 1000.0))
    p6km = interp.pres(prof, interp.to_msl(prof, 6000.0))
    sfc = prof.pres[prof.sfc]
    sfc_1km_shear = winds.wind_shear(prof, pbot=sfc, ptop=p1km)
    sfc_6km_shear = winds.wind_shear(prof, pbot=sfc, ptop=p6km)
    srh3km = winds.helicity(prof, 0, 3000.0, stu=srwind[0], stv=srwind[1])
    srh1km = winds.helicity(prof, 0, 1000.0, stu=srwind[0], stv=srwind[1])
    scp = params.scp(prof.mupcl.bplus, prof.right_esrh[0], prof.ebwspd)
    stp_cin = params.stp_cin(
        prof.mlpcl.bplus,
        prof.right_esrh[0],
        prof.ebwspd,
        prof.mlpcl.lclhght,
        prof.mlpcl.bminus,
    )
    stp_fixed = params.stp_fixed(
        prof.sfcpcl.bplus,
        prof.sfcpcl.lclhght,
        srh1km[0],
        utils.comp2vec(prof.sfc_6km_shear[0], prof.sfc_6km_shear[1])[1],
    )
    ship = params.ship(prof)

    def fmt(value, fmt="int"):
        if fmt == "int":
            try:
                val = int(value)
            except Exception:
                val = "M"
        else:
            try:
                val = round(value, 1)
            except Exception:
                val = "M"
        return val

    indices = {
        "SBCAPE": [fmt(prof.sfcpcl.bplus), "J/kg"],
        "MLCAPE": [fmt(prof.mlpcl.bplus), "J/kg"],
        "MUCAPE": [fmt(prof.mupcl.bplus), "J/kg"],
        "0-1 km SRH": [fmt(srh1km[0]), "m2/s2"],
        "0-3 km SRH": [fmt(srh3km[0]), "m2/s2"],
        "0-6 km Shear": [
            fmt(utils.comp2vec(sfc_6km_shear[0], sfc_6km_shear[1])[1]),
            "kts",
        ],
        "STP(fix)": [fmt(stp_fixed, "flt"), ""],
        "SHIP": [fmt(ship, "flt"), ""],
        "SCP": [fmt(scp, "flt"), ""],
        "STP(cin)": [fmt(stp_cin, "flt"), ""],
    }

    keys = np.sort(list(indices.keys()))
    string = ""
    counter = 0
    x = 0
    for key in keys:
        string = (
            string
            + key
            + ": "
            + str(indices[key][0])
            + " "
            + indices[key][1]
            + "\n"
        )
        if counter < 7:
            counter += 1
            continue
        counter = 0
        ax3.text(
            x,
            1,
            string,
            verticalalignment="top",
            transform=ax3.transAxes,
            fontsize=9,
        )
        string = ""
        x += 0.3
    ax3.text(
        x,
        1,
        string,
        verticalalignment="top",
        transform=ax3.transAxes,
        fontsize=9,
    )
    ax3.set_axis_off()

    gs.update(left=0.05, bottom=0.05, top=0.95, right=1, wspace=0.025)
    try:
        gs.tight_layout(fig)
    except Exception:
        pass

    plt.savefig(output_path, bbox_inches="tight", dpi=180)
    plt.close(fig)
    print(f"Imagem gravada em: {output_path}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python3 sharppy_renderer.py <entrada.csv> <saida.png>")
        sys.exit(1)
    run_renderer(sys.argv[1], sys.argv[2])
