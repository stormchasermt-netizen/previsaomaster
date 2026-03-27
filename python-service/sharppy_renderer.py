#!/usr/bin/env python3
"""
Imagem tipo sounding (Skew-T + hodógrafo + índices) usando:
- SHARPpy sharptab: perfil convectivo e parâmetros (CAPE, shear, etc.)
- MetPy SkewT / Hodograph: desenho compatível com Matplotlib 3.8+

O módulo sharppy.plot.skew está incompatível com Matplotlib 3.10 (API de Tick).
"""
from __future__ import annotations

import datetime
import os
import sys
import warnings

warnings.filterwarnings("ignore")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import gridspec
import numpy as np
import pandas as pd
from metpy.plots import Hodograph, SkewT
from metpy.units import units

import sharppy.sharptab.profile as profile
import sharppy.sharptab.params as params
import sharppy.sharptab.winds as winds
import sharppy.sharptab.utils as utils
import sharppy.sharptab.interp as interp


def _latitude() -> float:
    v = os.environ.get("SOUNDING_LATITUDE", "-23.5")
    try:
        return float(v)
    except ValueError:
        return -23.5


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
        date=datetime.datetime.now(),
    )

    title_txt = f"SHARPpy + MetPy (lat={lat:.2f})"

    fig = plt.figure(figsize=(11, 10))
    gs = gridspec.GridSpec(
        4,
        2,
        width_ratios=[1.35, 1.0],
        height_ratios=[1, 1, 1, 0.42],
        wspace=0.16,
        hspace=0.35,
    )

    skew = SkewT(fig, subplot=gs[0:3, 0], rotation=35)

    p_hpa = prof.pres * units.hPa
    T = np.asarray(prof.tmpc) * units.degC
    Td = np.asarray(prof.dwpc) * units.degC

    skew.plot(p_hpa, T, "r", lw=2)
    skew.plot(p_hpa, Td, "g", lw=2)
    try:
        skew.plot(p_hpa, np.asarray(prof.vtmp) * units.degC, "r--", lw=1, alpha=0.8)
        skew.plot(p_hpa, np.asarray(prof.wetbulb) * units.degC, "c-", lw=1, alpha=0.8)
    except Exception:
        pass
    try:
        mu_t = prof.mupcl.ttrace * units.degC
        mu_p = prof.mupcl.ptrace * units.hPa
        skew.plot(mu_p, mu_t, "k--", lw=1.5)
    except Exception:
        pass

    skew.ax.axvline(0, color="b", ls="--", alpha=0.7)
    skew.ax.axvline(-20, color="b", ls="--", alpha=0.7)
    skew.ax.set_title(title_txt, loc="left", fontsize=12, fontweight="bold")

    u_kt = np.array(
        [prof.u[i] if prof.u[i] != prof.missing else np.nan for i in range(len(prof.u))]
    )
    v_kt = np.array(
        [prof.v[i] if prof.v[i] != prof.missing else np.nan for i in range(len(prof.v))]
    )
    uq = u_kt * units.knots
    vq = v_kt * units.knots
    wind_skip = max(1, len(p_hpa) // 25)
    flip = lat < 0
    try:
        skew.plot_barbs(
            p_hpa[::wind_skip],
            uq[::wind_skip],
            vq[::wind_skip],
            flip_barb=flip,
            length=6,
        )
    except TypeError:
        skew.plot_barbs(
            p_hpa[::wind_skip], uq[::wind_skip], vq[::wind_skip], length=6
        )

    hodo_ax = fig.add_subplot(gs[0:3, 1])
    h = Hodograph(hodo_ax, component_range=80.0)
    h.add_grid(increment=10, color="gray", linestyle="--", alpha=0.5)
    z_m = np.asarray(prof.hght)
    mask = (z_m <= 12000) & ~np.isnan(u_kt) & ~np.isnan(v_kt)
    u_h = uq[mask]
    v_h = vq[mask]
    z_h = z_m[mask]
    intervals = [0, 3000, 6000, 9000, 12000]
    colors = ["red", "green", "blue", "black"]
    for i in range(len(intervals) - 1):
        m = (z_h >= intervals[i]) & (z_h <= intervals[i + 1])
        if np.sum(m) >= 2:
            h.plot(u_h[m], v_h[m], color=colors[i % len(colors)], linewidth=2)

    srwind = params.bunkers_storm_motion(prof)
    if srwind and len(srwind) >= 4:
        h.plot(srwind[0], srwind[1], "bo", markersize=8, label="RM")
        h.plot(srwind[2], srwind[3], "ro", markersize=8, label="LM")
        h.legend(loc="upper right", fontsize=8)
    hodo_ax.set_aspect("equal", adjustable="box")

    ax3 = fig.add_subplot(gs[3, :])

    p1km = interp.pres(prof, interp.to_msl(prof, 1000.0))
    p6km = interp.pres(prof, interp.to_msl(prof, 6000.0))
    sfc = prof.pres[prof.sfc]
    sfc_6km_shear = winds.wind_shear(prof, pbot=sfc, ptop=p6km)
    stu = srwind[0] if srwind else 0
    stv = srwind[1] if srwind else 0
    srh3km = winds.helicity(prof, 0, 3000.0, stu=stu, stv=stv)
    srh1km = winds.helicity(prof, 0, 1000.0, stu=stu, stv=stv)
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
                return int(value)
            except Exception:
                return "M"
        try:
            return round(value, 1)
        except Exception:
            return "M"

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
    lines = [f"{k}: {indices[k][0]} {indices[k][1]}" for k in keys]
    ax3.axis("off")
    ax3.text(
        0.02,
        0.98,
        "\n".join(lines),
        transform=ax3.transAxes,
        fontsize=9,
        verticalalignment="top",
        family="monospace",
    )

    try:
        fig.tight_layout()
    except Exception:
        pass

    plt.savefig(output_path, bbox_inches="tight", dpi=180, facecolor="white")
    plt.close(fig)
    print(f"Imagem gravada em: {output_path}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python3 sharppy_renderer.py <entrada.csv> <saida.png>")
        sys.exit(1)
    run_renderer(sys.argv[1], sys.argv[2])
