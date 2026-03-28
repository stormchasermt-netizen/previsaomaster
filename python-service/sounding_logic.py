import os

# Forçar Qt Headless e Bindings ANTES de qualquer outro import
os.environ["QT_API"] = "pyqt5"
os.environ["QT_QPA_PLATFORM"] = "offscreen"
os.environ["PYQTGRAPH_QT_LIB"] = "PyQt5"

import io
import base64
import datetime
import traceback
import platform
import pandas as pd
import numpy as np

# SHARPpy imports (devem vir depois de configurar o Qt)
import sharppy.sharptab as tab
import sharppy.io.spc_decoder as spc_decoder
from sutils.config import Config

# PyQt5 / Headless
from PyQt5.QtWidgets import QApplication
from PyQt5.QtGui import QImage, QPainter, QPolygonF, QColor, QPen, QBrush
from PyQt5.QtCore import Qt, QPointF, QRect, QPoint, QBuffer, QIODevice

# Fix para o erro: TypeError: argument 1 has unexpected type 'numpy.float64'
# O SHARPpy calcula coordenadas em numpy.float64, mas o PyQt5 (C++) exige float nativo ou int.
def _qc(a):
    if isinstance(a, (np.float64, np.float32, float)):
        return int(round(float(a)))
    return a

# Patch nos Construtores de Geometria (QRect, QPoint)
def patch_constructor(cls):
    orig_init = cls.__init__
    def new_init(self, *args, **kwargs):
        if len(args) > 0 and isinstance(args[0], (int, float, np.number)):
            args = [_qc(a) for a in args]
        try:
            orig_init(self, *args, **kwargs)
        except TypeError:
            # Fallback para evitar recursão ou erros de assinatura
            orig_init(self) 
    cls.__init__ = new_init

try:
    patch_constructor(QRect)
    patch_constructor(QPoint)
except:
    pass

def _patch_qt(cls, method_name):
    orig = getattr(cls, method_name)
    def fixed(self, *args):
        try:
            # Se for um QRect ou QPoint já construído, o PyQt aceita. 
            # O problema é quando passam floats diretamente p/ o método.
            new_args = [_qc(a) if isinstance(a, (float, np.number)) else a for a in args]
            return orig(self, *tuple(new_args))
        except:
            return orig(self, *args)
    setattr(cls, method_name, fixed)

for m in ['drawLine', 'drawRect', 'drawEllipse', 'drawPoint', 'drawText', 'drawPolygon', 'drawPolyline', 'drawLines']:
    _patch_qt(QPainter, m)

# --- THEME OVERRIDER (CLASSIC BLACK + CUSTOM HODO) ---
from sharppy.viz import thermo, kinematics, analogues, stp, hodo, watch, skew, srwinds
from qtpy import QtGui, QtCore

# 1. BARBELAS — sempre hemisfério sul (shemis=True: penachos à esquerda do eixo, WMO)
# Nota: (latitude>=0) no skew quebrava perfis com lat negativa (ex.: -25 → shemis=False = NH)
from sharppy.viz import barbs
orig_drawBarb = barbs.drawBarb
def drawBarb_hs(qp, x, y, wdir, wspd, color='#000000', shemis=False):
    c = color if color else '#000000'
    qp.setBrush(QBrush(QColor(c), Qt.SolidPattern))
    orig_drawBarb(qp, x, y, wdir, wspd, color=c, shemis=True)
    qp.setBrush(Qt.NoBrush)
barbs.drawBarb = drawBarb_hs
# skew e kinematics importam drawBarb no load; sem isto o patch em barbs não os altera
skew.drawBarb = barbs.drawBarb
kinematics.drawBarb = barbs.drawBarb

# 2. HODÓGRAFO — AGL relativo ao 1.º nível; cada cor só no intervalo [z_bot, z_top] (6–12 km roxo corta em 12 km)
# (Não redesenhar storm motion aqui — plotData já chama drawSMV; evita linha extra.)
_LAYER_COLORS = (
    QColor("#9B30FF"),  # 0 – 0.5 km roxo
    QColor("#CC0000"),  # 0.5 – 1 km vermelho
    QColor("#E65100"),  # 1 – 3 km laranja
    QColor("#2E7D32"),  # 3 – 6 km verde
    QColor("#6A1B9A"),  # 6 – 12 km roxo (só este intervalo; acima de 12 km não desenha)
)
# (z_bot_m, z_top_m, cor) — intervalos em m relativos ao 1.º nível
_HODO_BANDS = (
    (0, 500, _LAYER_COLORS[0]),
    (500, 1000, _LAYER_COLORS[1]),
    (1000, 3000, _LAYER_COLORS[2]),
    (3000, 6000, _LAYER_COLORS[3]),
    (6000, 12000, _LAYER_COLORS[4]),
)


def _interp_uv_at_z(z_t, z0, z1, u0, u1, v0, v1):
    dz = z1 - z0
    if abs(dz) < 1e-9:
        return float(u0), float(v0)
    t = (z_t - z0) / dz
    return u0 + t * (u1 - u0), v0 + t * (v1 - v0)


def new_draw_hodo(self, qp, prof, colors, width=2):
    mask = np.maximum(np.maximum(prof.u.mask, prof.v.mask), prof.hght.mask)
    z = tab.interp.to_agl(prof, prof.hght)[~mask]
    u = prof.u[~mask]
    v = prof.v[~mask]
    if len(u) < 2:
        return
    # Primeiro nível do perfil = 0 m (ex.: se o 1.º ponto era ~840 m AGL SHARPpy, a referência passa a ser esse nível)
    z = z - z[0]

    w = max(1, int(width))

    for i in range(len(u) - 1):
        z0, z1 = float(z[i]), float(z[i + 1])
        u0, u1 = float(u[i]), float(u[i + 1])
        v0, v1 = float(v[i]), float(v[i + 1])
        if z0 > z1:
            z0, z1 = z1, z0
            u0, u1 = u1, u0
            v0, v1 = v1, v0
        za, zb = z0, z1
        for L_bot, L_top, c in _HODO_BANDS:
            lo = max(za, L_bot)
            hi = min(zb, L_top)
            if lo >= hi - 1e-6:
                continue
            ua, va = _interp_uv_at_z(lo, z0, z1, u0, u1, v0, v1)
            ub, vb = _interp_uv_at_z(hi, z0, z1, u0, u1, v0, v1)
            qp.setPen(QPen(c, w, Qt.SolidLine))
            x1, y1 = self.uv_to_pix(ua, va)
            x2, y2 = self.uv_to_pix(ub, vb)
            qp.drawLine(x1, y1, x2, y2)

    # Marcadores de altitude nas passagens de borda (posição interpolada no limite)
    _labels = (("0.5", 500), ("1", 1000), ("3", 3000), ("6", 6000), ("12", 12000))
    for i in range(len(u) - 1):
        zi, zj = float(z[i]), float(z[i + 1])
        ui, uj = float(u[i]), float(u[i + 1])
        vi, vj = float(v[i]), float(v[i + 1])
        z_lo, z_hi = min(zi, zj), max(zi, zj)
        if abs(zj - zi) < 1e-9:
            continue
        for text, limit in _labels:
            if z_lo < limit <= z_hi:
                t = (limit - zi) / (zj - zi)
                uc = ui + t * (uj - ui)
                vc = vi + t * (vj - vi)
                x, y = self.uv_to_pix(uc, vc)
                qp.setPen(QPen(QColor("#000000"), 1))
                qp.drawText(int(x + 3), int(y + 3), text)

hodo.plotHodo.draw_hodo = new_draw_hodo

# 3a. SUPERCELL — rótulo curto "STP 0.5=" (Thompson STP fixo com SRH 0–500 m)
_orig_draw_severe = thermo.plotText.drawSevere


def new_draw_severe(self, qp):
    pen = QtGui.QPen(QtCore.Qt.yellow, 1, QtCore.Qt.SolidLine)
    self.label_font.setBold(True)
    qp.setFont(self.label_font)
    color_list = self.alert_colors
    x1 = self.brx / 10
    y1 = self.ylast + self.tpad

    ship = self.prof.ship
    ship_str = tab.utils.FLOAT2STR(ship, 1)

    if self.use_left:
        stp_fixed = self.prof.left_stp_fixed
        stp_cin = self.prof.left_stp_cin
        scp = self.prof.left_scp
    else:
        stp_fixed = self.prof.right_stp_fixed
        stp_cin = self.prof.right_stp_cin
        scp = self.prof.right_scp

    stp_fixed_str = tab.utils.FLOAT2STR(stp_fixed, 1)
    stp_cin_str = tab.utils.FLOAT2STR(stp_cin, 1)
    scp_str = tab.utils.FLOAT2STR(scp, 1)

    wspd = tab.utils.mag(self.prof.sfc_6km_shear[0], self.prof.sfc_6km_shear[1])
    if self.use_left:
        srh05 = tab.winds.helicity(
            self.prof, 0, 500.0, stu=self.prof.srwind[2], stv=self.prof.srwind[3]
        )[0]
    else:
        srh05 = tab.winds.helicity(
            self.prof, 0, 500.0, stu=self.prof.srwind[0], stv=self.prof.srwind[1]
        )[0]
    try:
        stp_05 = tab.params.stp_fixed(
            float(self.prof.sfcpcl.bplus),
            float(self.prof.sfcpcl.lclhght),
            float(srh05),
            tab.utils.KTS2MS(wspd),
        )
    except Exception:
        stp_05 = 0.0
    stp_05_str = tab.utils.FLOAT2STR(stp_05, 1)

    if self.prof.latitude < 0:
        stp_fixed = -stp_fixed
        stp_cin = -stp_cin
        scp = -scp
        stp_05 = -stp_05

    labels = [
        "Supercell = ",
        "STP (cin) = ",
        "STP (fix) = ",
        "STP 0.5= ",
        "SHIP = ",
    ]
    indices = [scp, stp_cin, stp_fixed, stp_05, ship]
    index_strs = [scp_str, stp_cin_str, stp_fixed_str, stp_05_str, ship_str]

    for label, index_str, index in zip(labels, index_strs, indices):
        rect = QtCore.QRect(
            int(x1 * 7), int(y1), int(x1 * 8), int(self.label_height)
        )
        if index == "--":
            pen = QtGui.QPen(color_list[0], 1, QtCore.Qt.SolidLine)
        elif label == labels[0]:
            if index >= 19.95:
                pen = QtGui.QPen(color_list[5], 1, QtCore.Qt.SolidLine)
            elif index >= 11.95:
                pen = QtGui.QPen(color_list[4], 1, QtCore.Qt.SolidLine)
            elif index >= 1.95:
                pen = QtGui.QPen(color_list[2], 1, QtCore.Qt.SolidLine)
            elif index >= 0.45:
                pen = QtGui.QPen(color_list[1], 1, QtCore.Qt.SolidLine)
            elif index >= -0.45:
                pen = QtGui.QPen(color_list[0], 1, QtCore.Qt.SolidLine)
            elif index < -0.45:
                pen = QtGui.QPen(self.left_scp_color, 1, QtCore.Qt.SolidLine)
        elif label == labels[1]:
            if index >= 8:
                pen = QtGui.QPen(color_list[5], 1, QtCore.Qt.SolidLine)
            elif index >= 4:
                pen = QtGui.QPen(color_list[4], 1, QtCore.Qt.SolidLine)
            elif index >= 2:
                pen = QtGui.QPen(color_list[3], 1, QtCore.Qt.SolidLine)
            elif index >= 1:
                pen = QtGui.QPen(color_list[2], 1, QtCore.Qt.SolidLine)
            elif index >= 0.5:
                pen = QtGui.QPen(color_list[1], 1, QtCore.Qt.SolidLine)
            elif index < 0.5:
                pen = QtGui.QPen(color_list[0], 1, QtCore.Qt.SolidLine)
        elif label == labels[2]:
            if index >= 7:
                pen = QtGui.QPen(color_list[5], 1, QtCore.Qt.SolidLine)
            elif index >= 5:
                pen = QtGui.QPen(color_list[4], 1, QtCore.Qt.SolidLine)
            elif index >= 2:
                pen = QtGui.QPen(color_list[3], 1, QtCore.Qt.SolidLine)
            elif index >= 1:
                pen = QtGui.QPen(color_list[2], 1, QtCore.Qt.SolidLine)
            elif index >= 0.5:
                pen = QtGui.QPen(color_list[1], 1, QtCore.Qt.SolidLine)
            else:
                pen = QtGui.QPen(color_list[0], 1, QtCore.Qt.SolidLine)
        elif label == labels[3]:
            if index >= 7:
                pen = QtGui.QPen(color_list[5], 1, QtCore.Qt.SolidLine)
            elif index >= 5:
                pen = QtGui.QPen(color_list[4], 1, QtCore.Qt.SolidLine)
            elif index >= 2:
                pen = QtGui.QPen(color_list[3], 1, QtCore.Qt.SolidLine)
            elif index >= 1:
                pen = QtGui.QPen(color_list[2], 1, QtCore.Qt.SolidLine)
            elif index >= 0.5:
                pen = QtGui.QPen(color_list[1], 1, QtCore.Qt.SolidLine)
            else:
                pen = QtGui.QPen(color_list[0], 1, QtCore.Qt.SolidLine)
        elif label == labels[4]:
            if index >= 5:
                pen = QtGui.QPen(color_list[5], 1, QtCore.Qt.SolidLine)
            elif index >= 2:
                pen = QtGui.QPen(color_list[4], 1, QtCore.Qt.SolidLine)
            elif index >= 1:
                pen = QtGui.QPen(color_list[3], 1, QtCore.Qt.SolidLine)
            elif index >= 0.5:
                pen = QtGui.QPen(color_list[2], 1, QtCore.Qt.SolidLine)
            else:
                pen = QtGui.QPen(color_list[0], 1, QtCore.Qt.SolidLine)
        qp.setPen(pen)
        qp.drawText(
            rect,
            QtCore.Qt.TextDontClip | QtCore.Qt.AlignLeft,
            label + index_str,
        )
        vspace = self.label_height
        if platform.system() == "Windows":
            vspace += self.label_metrics.descent()
        y1 += vspace
    self.label_font.setBold(False)


thermo.plotText.drawSevere = new_draw_severe

# 3b. KINEMATICS — rótulos SFC - 0.5/1/3 km + linhas de dados; SR Wind trace roxo
_orig_kin_frame = kinematics.backgroundKinematics.draw_frame


def new_kin_draw_frame(self, qp):
    pen = QtGui.QPen(self.fg_color, 1, QtCore.Qt.SolidLine)
    qp.setPen(pen)
    qp.setFont(self.label_font)
    x1 = self.brx / 10
    y1 = self.label_height + self.tpad
    rect1 = QtCore.QRect(int(x1 * 2.5), int(3), int(x1), int(self.label_height))
    rect2 = QtCore.QRect(int(x1 * 5), int(3), int(x1), int(self.label_height))
    rect3 = QtCore.QRect(int(x1 * 7), int(3), int(x1), int(self.label_height))
    rect4 = QtCore.QRect(int(x1 * 9 - self.rpad), int(3), int(x1), int(self.label_height))
    if self.wind_units == "m/s":
        disp_unit = "m/s"
    else:
        disp_unit = "kt"
    qp.drawText(rect1, QtCore.Qt.TextDontClip | QtCore.Qt.AlignCenter, "SRH (m2/s2)")
    qp.drawText(
        rect2,
        QtCore.Qt.TextDontClip | QtCore.Qt.AlignCenter,
        "Shear (%s)" % disp_unit,
    )
    qp.drawText(rect3, QtCore.Qt.TextDontClip | QtCore.Qt.AlignCenter, "MnWind")
    qp.drawText(rect4, QtCore.Qt.TextDontClip | QtCore.Qt.AlignCenter, "SRW")
    texts = ["SFC - 0.5km", "SFC - 1km", "SFC - 3km", "Eff Inflow Layer"]
    for text in texts:
        rect = QtCore.QRect(int(self.lpad), int(y1), int(x1), int(self.label_height))
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignLeft, text)
        vspace = self.label_height
        if platform.system() == "Windows":
            vspace += self.label_metrics.descent()
        y1 += vspace
    self.ylast = y1
    texts = ["SFC-6km", "SFC-8km", "LCL-EL (Cloud Layer)", "Eff Shear (EBWD)"]
    y1 = self.ylast + self.tpad
    for text in texts:
        rect = QtCore.QRect(int(self.lpad), int(y1), int(x1), int(self.label_height))
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignLeft, text)
        vspace = self.label_height
        if platform.system() == "Windows":
            vspace += self.label_metrics.descent()
        y1 += vspace
    self.ylast = y1
    texts = ["BRN Shear = ", "4-6km SR Wind = "]
    y1 = self.ylast + self.tpad
    for text in texts:
        rect = QtCore.QRect(int(self.lpad), int(y1), int(x1), int(self.label_height))
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignLeft, text)
        vspace = self.label_height
        if platform.system() == "Windows":
            vspace += self.label_metrics.descent()
        y1 += vspace
    self.ylast = y1
    texts = [
        "...Storm Motion Vectors...",
        "Bunkers Right = ",
        "Bunkers Left = ",
        "Corfidi Downshear = ",
        "Corfidi Upshear = ",
    ]
    y1 = self.ylast + self.tpad
    self.barby = y1 + self.tpad
    for text in texts:
        rect = QtCore.QRect(int(self.lpad), int(y1), int(x1), int(self.label_height))
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignLeft, text)
        vspace = self.label_height
        if platform.system() == "Windows":
            vspace += self.label_metrics.descent()
        y1 += vspace
    self.ylast = vspace
    qp.drawLine(0, self.ylast + 3, self.brx, self.ylast + 3)


kinematics.backgroundKinematics.draw_frame = new_kin_draw_frame

_orig_draw_kinematics = kinematics.plotKinematics.drawKinematics


def new_draw_kinematics(self, qp):
    pen = QtGui.QPen(self.fg_color, 1, QtCore.Qt.SolidLine)
    qp.setPen(pen)
    qp.setFont(self.label_font)
    x1 = self.brx / 10
    y1 = self.ylast + self.tpad
    if self.wind_units == "m/s":
        disp_unit = " m/s"
        conv = tab.utils.KTS2MS
    else:
        disp_unit = " kt"
        conv = lambda s: s

    srh1km = tab.utils.INT2STR(self.srh1km[0])
    srh3km = tab.utils.INT2STR(self.srh3km[0])
    sfc1km = tab.utils.INT2STR(
        conv(tab.utils.mag(self.sfc_1km_shear[0], self.sfc_1km_shear[1]))
    )
    sfc3km = tab.utils.INT2STR(
        conv(tab.utils.mag(self.sfc_3km_shear[0], self.sfc_3km_shear[1]))
    )
    sfc6km = tab.utils.INT2STR(
        conv(tab.utils.mag(self.sfc_6km_shear[0], self.sfc_6km_shear[1]))
    )
    sfc8km = tab.utils.INT2STR(
        conv(tab.utils.mag(self.sfc_8km_shear[0], self.sfc_8km_shear[1]))
    )
    lcl_el = tab.utils.INT2STR(
        conv(tab.utils.mag(self.lcl_el_shear[0], self.lcl_el_shear[1]))
    )
    mean_1km = (
        tab.utils.INT2STR(np.float64(self.mean_1km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.mean_1km[1]))
    )
    mean_3km = (
        tab.utils.INT2STR(np.float64(self.mean_3km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.mean_3km[1]))
    )
    mean_6km = (
        tab.utils.INT2STR(np.float64(self.mean_6km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.mean_6km[1]))
    )
    mean_8km = (
        tab.utils.INT2STR(np.float64(self.mean_8km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.mean_8km[1]))
    )
    mean_lcl_el = (
        tab.utils.INT2STR(np.float64(self.mean_lcl_el[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.mean_lcl_el[1]))
    )
    srw_1km = (
        tab.utils.INT2STR(np.float64(self.srw_1km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.srw_1km[1]))
    )
    srw_3km = (
        tab.utils.INT2STR(np.float64(self.srw_3km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.srw_3km[1]))
    )
    srw_6km = (
        tab.utils.INT2STR(np.float64(self.srw_6km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.srw_6km[1]))
    )
    srw_8km = (
        tab.utils.INT2STR(np.float64(self.srw_8km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.srw_8km[1]))
    )
    srw_lcl_el = (
        tab.utils.INT2STR(np.float64(self.srw_lcl_el[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.srw_lcl_el[1]))
    )
    srw_4_5km = (
        tab.utils.INT2STR(np.float64(self.srw_4_5km[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.srw_4_5km[1]))
        + disp_unit
    )
    esrh = tab.utils.INT2STR(self.esrh[0])
    eff_lr = tab.utils.INT2STR(conv(tab.utils.mag(self.eff_shear[0], self.eff_shear[1])))
    efbwd = tab.utils.INT2STR(conv(tab.utils.mag(self.ebwd[0], self.ebwd[1])))
    mean_eff = (
        tab.utils.INT2STR(np.float64(self.mean_eff[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.mean_eff[1]))
    )
    mean_ebw = (
        tab.utils.INT2STR(np.float64(self.mean_ebw[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.mean_ebw[1]))
    )
    srw_eff = (
        tab.utils.INT2STR(np.float64(self.srw_eff[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.srw_eff[1]))
    )
    srw_ebw = (
        tab.utils.INT2STR(np.float64(self.srw_ebw[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.srw_ebw[1]))
    )
    brn_shear = tab.utils.INT2STR(self.brn_shear) + " m2/s2"
    bunkers_left = (
        tab.utils.INT2STR(np.float64(self.bunkers_left_vec[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.bunkers_left_vec[1]))
        + disp_unit
    )
    bunkers_right = (
        tab.utils.INT2STR(np.float64(self.bunkers_right_vec[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.bunkers_right_vec[1]))
        + disp_unit
    )
    upshear = (
        tab.utils.INT2STR(np.float64(self.upshear[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.upshear[1]))
        + disp_unit
    )
    downshear = (
        tab.utils.INT2STR(np.float64(self.downshear[0]))
        + "/"
        + tab.utils.INT2STR(conv(self.downshear[1]))
        + disp_unit
    )

    prof = self.prof
    psfc = prof.pres[prof.sfc]
    p500 = tab.interp.pres(prof, tab.interp.to_msl(prof, 500.0))
    sfc_05_shear = tab.winds.wind_shear(prof, psfc, p500)
    mean_05 = tab.utils.comp2vec(*tab.winds.mean_wind(prof, pbot=psfc, ptop=p500))
    if self.use_left:
        srh05 = tab.winds.helicity(
            prof, 0, 500.0, stu=prof.srwind[2], stv=prof.srwind[3]
        )[0]
        srw_05 = tab.utils.comp2vec(
            *tab.winds.sr_wind(
                prof, pbot=psfc, ptop=p500, stu=prof.srwind[2], stv=prof.srwind[3]
            )
        )
    else:
        srh05 = tab.winds.helicity(
            prof, 0, 500.0, stu=prof.srwind[0], stv=prof.srwind[1]
        )[0]
        srw_05 = tab.utils.comp2vec(
            *tab.winds.sr_wind(
                prof, pbot=psfc, ptop=p500, stu=prof.srwind[0], stv=prof.srwind[1]
            )
        )
    srh05s = tab.utils.INT2STR(srh05)
    sfc05s = tab.utils.INT2STR(
        conv(tab.utils.mag(sfc_05_shear[0], sfc_05_shear[1]))
    )
    mean05s = (
        tab.utils.INT2STR(np.float64(mean_05[0]))
        + "/"
        + tab.utils.INT2STR(conv(mean_05[1]))
    )
    srw05s = (
        tab.utils.INT2STR(np.float64(srw_05[0]))
        + "/"
        + tab.utils.INT2STR(conv(srw_05[1]))
    )

    texts = [srh05s, sfc05s, mean05s, srw05s]
    count = 3
    for text in texts:
        rect = QtCore.QRect(
            int(x1 * count), int(y1), int(x1), int(self.label_height)
        )
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        count += 2
    vspace = self.label_height
    if platform.system() == "Windows":
        vspace += self.label_metrics.descent()
    y1 += vspace
    self.ylast = y1
    texts = [srh1km, sfc1km, mean_1km, srw_1km]
    count = 3
    for text in texts:
        rect = QtCore.QRect(
            int(x1 * count), int(y1), int(x1), int(self.label_height)
        )
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        count += 2
    vspace = self.label_height
    if platform.system() == "Windows":
        vspace += self.label_metrics.descent()
    y1 += vspace
    self.ylast = y1
    texts = [srh3km, sfc3km, mean_3km, srw_3km]
    count = 3
    for text in texts:
        rect = QtCore.QRect(
            int(x1 * count), int(y1), int(x1), int(self.label_height)
        )
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        count += 2
    vspace = self.label_height
    if platform.system() == "Windows":
        vspace += self.label_metrics.descent()
    y1 += vspace
    self.ylast = y1
    texts = [esrh, eff_lr, mean_eff, srw_eff]
    count = 3
    for text in texts:
        rect = QtCore.QRect(
            int(x1 * count), int(y1), int(x1), int(self.label_height)
        )
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        count += 2
    vspace = self.label_height + self.tpad
    if platform.system() == "Windows":
        vspace += self.label_metrics.descent()
    y1 += vspace
    self.ylast = y1
    texts = [sfc6km, mean_6km, srw_6km]
    count = 5
    for text in texts:
        rect = QtCore.QRect(
            int(x1 * count), int(y1), int(x1), int(self.label_height)
        )
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        count += 2
    vspace = self.label_height
    if platform.system() == "Windows":
        vspace += self.label_metrics.descent()
    y1 += vspace
    self.ylast = y1
    texts = [sfc8km, mean_8km, srw_8km]
    count = 5
    for text in texts:
        rect = QtCore.QRect(
            int(x1 * count), int(y1), int(x1), int(self.label_height)
        )
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        count += 2
    vspace = self.label_height
    if platform.system() == "Windows":
        vspace += self.label_metrics.descent()
    y1 += vspace
    self.ylast = y1
    texts = [lcl_el, mean_lcl_el, srw_lcl_el]
    count = 5
    for text in texts:
        rect = QtCore.QRect(
            int(x1 * count), int(y1), int(x1), int(self.label_height)
        )
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        count += 2
    vspace = self.label_height
    if platform.system() == "Windows":
        vspace += self.label_metrics.descent()
    y1 += vspace
    self.ylast = y1
    texts = [efbwd, mean_ebw, srw_ebw]
    count = 5
    for text in texts:
        rect = QtCore.QRect(
            int(x1 * count), int(y1), int(x1), int(self.label_height)
        )
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        count += 2
    vspace = self.label_height + self.tpad
    if platform.system() == "Windows":
        vspace += self.label_metrics.descent()
    y1 += vspace
    self.ylast = y1
    texts = [brn_shear, srw_4_5km]
    for text in texts:
        rect = QtCore.QRect(int(x1 * 5), int(y1), int(x1), int(self.label_height))
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        vspace = self.label_height
        if platform.system() == "Windows":
            vspace += self.label_metrics.descent()
        y1 += vspace
    self.ylast = y1
    y1 += self.label_height + self.tpad
    texts = [bunkers_right, bunkers_left]
    colors = [QtGui.QColor("#0099CC"), QtGui.QColor("#FF6666")]
    for text, color in zip(texts, colors):
        rect = QtCore.QRect(int(x1 * 5), int(y1), int(x1), int(self.label_height))
        pen = QtGui.QPen(color, 1, QtCore.Qt.SolidLine)
        qp.setPen(pen)
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        vspace = self.label_height
        if platform.system() == "Windows":
            vspace += self.label_metrics.descent()
        y1 += vspace
    self.ylast = y1
    pen = QtGui.QPen(self.fg_color, 1, QtCore.Qt.SolidLine)
    qp.setPen(pen)
    texts = [downshear, upshear]
    for text in texts:
        rect = QtCore.QRect(int(x1 * 5), int(y1), int(x1), int(self.label_height))
        qp.drawText(rect, QtCore.Qt.TextDontClip | QtCore.Qt.AlignRight, text)
        vspace = self.label_height
        if platform.system() == "Windows":
            vspace += self.label_metrics.descent()
        y1 += vspace


kinematics.plotKinematics.drawKinematics = new_draw_kinematics

_orig_srw_draw_profile = srwinds.plotWinds.draw_profile


def new_srw_draw_profile(self, qp):
    tc = self.trace_color
    self.trace_color = QColor("#9B30FF")
    try:
        _orig_srw_draw_profile(self, qp)
    finally:
        self.trace_color = tc


srwinds.plotWinds.draw_profile = new_srw_draw_profile

# 3. SKEW-T (Parcela ML Tracejada Vermelha)
orig_skew_plotData = skew.plotSkewT.plotData
def new_skew_plotData(self):
    if self.prof:
        self.pcl = self.prof.mlpcl
    orig_skew_plotData(self)
skew.plotSkewT.plotData = new_skew_plotData

orig_drawParcel = skew.plotSkewT.drawVirtualParcelTrace
def new_drawParcel(self, ttrace, ptrace, qp, color=QColor("#000000")):
    # Preto tracejado
    pen = QPen(QColor("#000000"), 1, Qt.DashLine)
    qp.setPen(pen)
    if len(ttrace) > 1:
        for i in range(len(ttrace)-1):
            x1, y1 = self.tmpc_to_pix(ttrace[i], ptrace[i]), self.pres_to_pix(ptrace[i])
            x2, y2 = self.tmpc_to_pix(ttrace[i+1], ptrace[i+1]), self.pres_to_pix(ptrace[i+1])
            qp.drawLine(self.originx + x1/self.scale, self.originy + y1/self.scale,
                        self.originx + x2/self.scale, self.originy + y2/self.scale)
skew.plotSkewT.drawVirtualParcelTrace = new_drawParcel

# Importar o Widget Central do SHARPpy e a Coleção de Perfis
from sharppy.viz.SPCWindow import SPCWidget
from sharppy.sharptab.prof_collection import ProfCollection

# ═══════════════════════════════════════════
# CONFIG HELPER
# ═══════════════════════════════════════════

def get_native_config():
    """Carrega o sharppy_config.ini original do usuário."""
    ini_path = os.path.join(os.path.dirname(__file__), 'sharppy_config.ini')
    cfg = Config(ini_path)
    return cfg

# ═══════════════════════════════════════════
# RENDER LOGIC
# ═══════════════════════════════════════════

# Precisamos de uma instância global do QApplication para rodar headless
# (O Qt não permite múltiplas instâncias ou instâncias sem um loop principal)
_qapp = None

def get_qapp():
    global _qapp
    if _qapp is None:
        import sys
        _qapp = QApplication.instance() or QApplication(sys.argv)
    return _qapp

def render_to_base64(csv_text, title="Sounding", is_hs=True):
    """
    Renderiza os componentes nativos do SHARPpy para uma imagem Base64.
    """
    try:
        app = get_qapp()
        
        # 1. Parse CSV para Profile do SHARPpy
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
        
        # Criar objeto Profile
        p = df['pres'].astype(float).tolist()
        h = df['hght'].astype(float).tolist()
        t = df['temp'].astype(float).tolist()
        td = df['dwpt'].astype(float).tolist()
        wd = df['wdir'].astype(float).tolist()
        ws = df['wspd'].astype(float).tolist()
        
        # Forçar latitude negativa para Hemisfério Sul se solicitado
        lat = -25.0 if is_hs else 40.0 
        curr_date = datetime.datetime.now()
        
        prof = tab.profile.create_profile(
            profile='convective',
            pres=p, hght=h, tmpc=t, dwpc=td, wspd=ws, wdir=wd,
            lat=lat,
            date=curr_date
        )
        
        # Criar Coleção (necessário para o SPCWidget)
        # O ProfCollection espera um dict de membros e uma lista de datas
        prof_dict = {'Sounding': [prof]}
        dates = [curr_date]
        prof_col = ProfCollection(prof_dict, dates)
        prof_col.setMeta('observed', True)
        prof_col.setMeta('loc', 'SNDG')
        prof_col.setMeta('model', 'PVMaster')
        prof_col.setMeta('run', curr_date)
        prof_col.setMeta('base_time', curr_date)
        
        # 2. Configurar o Widget Nativo
        cfg = get_native_config()
        
        # O SPCWidget monta o layout idêntico ao da imagem
        widget = SPCWidget(cfg=cfg)
        widget.addProfileCollection(prof_col, "Sounding")
        
        # Ajustar para Hemisfério Sul (Bunkers Left) caso o widget não detecte
        if is_hs:
            widget.toggleVector('left') # Força Bunkers Left Mover como foco
        
        # Forçar o tamanho (SPC padrão é 1180x800 como visto no Windows em SPCWindow.py)
        width, height = 1180, 800
        widget.resize(width, height)
        widget.setAttribute(Qt.WA_DontShowOnScreen)
        widget.show()
        
        # 3. Capturar Imagem
        # O grab() captura o widget exatamente como ele aparece na tela
        pixmap = widget.grab()
        
        # Converter para Base64
        byte_array = io.BytesIO()
        img = pixmap.toImage()
        buffer = QBuffer()
        buffer.open(QIODevice.ReadWrite)
        img.save(buffer, "PNG")
        
        b64 = base64.b64encode(buffer.data()).decode('utf-8')
        
        # Limpar
        widget.deleteLater()
        
        return {
            'base64_img': f'data:image/png;base64,{b64}',
            'status': 'success'
        }

    except Exception as e:
        return {
            'error': str(e),
            'trace': traceback.format_exc(),
            'status': 'error'
        }

def process_csv_content(csv_text, image_title="Sounding", generate_image=True, layout_config=None):
    """Router para a versão nativa."""
    # Como o usuário quer Nativo, ignoramos cálculos manuais e usamos o motor do widget
    if not generate_image:
        # Se quiser apenas índices, ainda retornamos o dict do profile do SHARPpy
        # mas aqui focaremos na imagem "Gold Standard" solicitada
        return {'error': 'Apenas renderização nativa suportada nesta versão.'}
        
    return render_to_base64(csv_text, title=image_title, is_hs=True)

# Helper para o test_render.py
def render_to_file(csv_text, output_path, title="Sounding"):
    res = render_to_base64(csv_text, title, is_hs=True)
    if res['status'] == 'success':
        # Decodificar e salvar
        header, data = res['base64_img'].split(',')
        with open(output_path, "wb") as fh:
            fh.write(base64.b64decode(data))
        return True
    else:
        print(f"Erro no render: {res['error']}")
        return False
