"""Shared setup and chart style for the wildfire notebooks.

Every notebook starts with `import viz; viz.setup()`, which puts backend/ on the
import path (so `ml.wildfire` imports work from this folder) and applies one
matplotlib style, so the charts read as one set.
"""

import logging
import sys
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt

# Light-mode chart palette. Notebooks render as static images on a light page.
SURFACE = "#fcfcfb"
INK = "#0b0b0b"  # Titles and values
INK_SECONDARY = "#52514e"  # Axis labels, annotations
INK_MUTED = "#898781"  # Tick labels
GRID = "#e1e0d9"
AXIS = "#c3c2b7"

# Categorical slots, in fixed order: slot 1 is always the model, slot 2 the baseline.
BLUE = "#2a78d6"
ORANGE = "#eb6834"
# Diverging pair for SHAP: red pushes fire probability up, blue pushes it down.
RAISES = "#e34948"
LOWERS = "#2a78d6"
# Sequential blue ramp, light to dark, for magnitudes (probability maps).
SEQUENTIAL = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]


def setup() -> Path:
    """Add backend/ to sys.path and apply the chart style.

    Returns:
        The backend directory.
    Called by: the first code cell of every notebook in this folder.
    """
    backend = Path(__file__).resolve().parents[3]
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    # Matplotlib warns while probing fallback fonts for the semibold title weight,
    # even when the first-choice font (Segoe UI) is used.
    logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
    mpl.rcParams.update(
        {
            "figure.facecolor": SURFACE,
            "axes.facecolor": SURFACE,
            "savefig.facecolor": SURFACE,
            "figure.dpi": 110,
            "figure.figsize": (8, 4),
            "font.family": ["Segoe UI", "DejaVu Sans", "sans-serif"],
            "font.size": 10,
            "text.color": INK,
            "axes.titlecolor": INK,
            "axes.titlesize": 12,
            "axes.titleweight": "semibold",
            "axes.titlelocation": "left",
            "axes.titlepad": 12,
            "axes.labelcolor": INK_SECONDARY,
            "axes.edgecolor": AXIS,
            "axes.linewidth": 0.8,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "axes.axisbelow": True,
            "grid.color": GRID,
            "grid.linewidth": 0.6,
            "xtick.color": INK_MUTED,
            "ytick.color": INK_MUTED,
            "xtick.labelcolor": INK_SECONDARY,
            "ytick.labelcolor": INK_SECONDARY,
            "lines.linewidth": 2,
            "lines.solid_capstyle": "round",
            "legend.frameon": False,
            "legend.labelcolor": INK_SECONDARY,
            "patch.linewidth": 0,
        }
    )
    return backend


def bars(ax, x, heights, color=BLUE, width=0.75, **kwargs):
    """Draw bars with a surface-colored gap between neighbors.

    Args:
        ax: Matplotlib axes.
        x: Bar positions.
        heights: Bar heights.
        color: Fill color.
        width: Bar width as a fraction of the spacing.
        **kwargs: Passed to ax.bar.
    Returns:
        The BarContainer.
    Called by: the notebooks in this folder.
    """
    return ax.bar(x, heights, width=width, color=color, edgecolor=SURFACE, linewidth=1.5, **kwargs)


def hbars(ax, y, widths, color=BLUE, height=0.7, **kwargs):
    """Horizontal version of bars().

    Args:
        ax: Matplotlib axes.
        y: Bar positions.
        widths: Bar lengths.
        color: Fill color, or one color per bar.
        height: Bar thickness as a fraction of the spacing.
        **kwargs: Passed to ax.barh.
    Returns:
        The BarContainer.
    Called by: the notebooks in this folder.
    """
    return ax.barh(y, widths, height=height, color=color, edgecolor=SURFACE, linewidth=1.5, **kwargs)


def finish(ax, grid_axis: str = "y") -> None:
    """Keep gridlines on the value axis only.

    Args:
        ax: Matplotlib axes.
        grid_axis: "x", "y" or "both".
    Returns:
        None.
    Called by: the notebooks in this folder.
    """
    ax.grid(False)
    ax.grid(True, axis=grid_axis)


def show() -> None:
    """Lay out and display the current figure.

    Called by: the notebooks in this folder.
    """
    plt.tight_layout()
    plt.show()
