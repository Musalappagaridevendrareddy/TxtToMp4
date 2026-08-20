"""The design system is a contract, not a suggestion."""

from __future__ import annotations

import re

import pytest

from manim_scenes import theme
from manim_scenes.theme import PALETTES, Palette, get_palette

HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def test_exactly_three_palettes():
    # Mirrors the Palette enum in packages/spec/src/schema.ts.
    assert set(PALETTES) == {"cool", "warm", "neutral"}


@pytest.mark.parametrize("name", sorted(PALETTES))
def test_palette_has_four_colours_and_a_ground(name):
    palette = get_palette(name)
    assert isinstance(palette, Palette)
    assert len(palette.colors) == 4
    assert len(set(palette.colors)) == 4, "the four inks must be distinguishable"
    assert palette.bg not in palette.colors, "the ground is not one of the inks"


@pytest.mark.parametrize("name", sorted(PALETTES))
def test_every_colour_is_valid_hex(name):
    palette = get_palette(name)
    for value in (palette.bg, *palette.colors):
        assert HEX.match(value), f"{name}: {value!r} is not a #rrggbb hex colour"


@pytest.mark.parametrize("name", sorted(PALETTES))
def test_palette_exposes_the_documented_roles(name):
    palette = get_palette(name)
    for role in ("bg", "primary", "secondary", "accent", "muted"):
        assert isinstance(getattr(palette, role), str)


def test_grounds_are_dark_enough_to_carry_light_type():
    # Every palette is a dark-ground design; a light bg would break every
    # archetype's contrast assumptions in one go.
    for name in PALETTES:
        r, g, b = _rgb(get_palette(name).bg)
        luminance = 0.299 * r + 0.587 * g + 0.114 * b
        assert luminance < 40, f"{name} background is too light ({luminance:.0f}/255)"


def test_accent_is_brighter_than_muted():
    for name in PALETTES:
        palette = get_palette(name)
        assert _luma(palette.accent) > _luma(palette.muted), (
            f"{name}: the accent has to outrank the muted ink"
        )


def test_unknown_palette_names_the_valid_ones():
    with pytest.raises(ValueError) as exc:
        get_palette("neon")
    message = str(exc.value)
    assert "neon" in message
    for name in PALETTES:
        assert name in message


def test_exactly_two_font_sizes():
    sizes = {
        name: value
        for name, value in vars(theme).items()
        if name.startswith("FONT_") and isinstance(value, (int, float))
    }
    assert set(sizes) == {"FONT_TITLE", "FONT_BODY"}, f"found extra type sizes: {sizes}"
    assert theme.FONT_TITLE > theme.FONT_BODY


def test_frame_is_sixteen_by_nine_at_1080p30():
    assert theme.PIXEL_WIDTH == 1920
    assert theme.PIXEL_HEIGHT == 1080
    assert theme.FPS == 30
    assert theme.PIXEL_WIDTH / theme.PIXEL_HEIGHT == pytest.approx(theme.ASPECT_RATIO)
    assert theme.FRAME_WIDTH / theme.FRAME_HEIGHT == pytest.approx(theme.ASPECT_RATIO)


def test_safe_area_is_the_frame_minus_the_margins():
    assert theme.SAFE_WIDTH == pytest.approx(theme.FRAME_WIDTH - 2 * theme.MARGIN)
    # Asymmetric on purpose: Remotion's caption plate owns the bottom of the frame.
    assert theme.SAFE_HEIGHT == pytest.approx(
        theme.FRAME_HEIGHT - theme.MARGIN - theme.BOTTOM_MARGIN
    )
    assert theme.BOTTOM_MARGIN > theme.MARGIN


def test_the_caption_band_is_reserved_and_the_safe_centre_clears_it():
    assert theme.CAPTION_ZONE == pytest.approx(0.18 * theme.FRAME_HEIGHT)
    # The optical centre of the safe area sits above the frame's own centre.
    assert theme.SAFE_CENTER_Y == pytest.approx((theme.BOTTOM_MARGIN - theme.MARGIN) / 2)
    assert theme.SAFE_CENTER_Y > 0
    safe_bottom = theme.SAFE_CENTER_Y - theme.SAFE_HEIGHT / 2
    assert safe_bottom == pytest.approx(-theme.FRAME_HEIGHT / 2 + theme.BOTTOM_MARGIN)


def test_max_elements_matches_the_typescript_contract():
    assert theme.MAX_ELEMENTS == 5


def test_the_two_easings_behave_like_easings():
    for ease in (theme.EASE_IN, theme.EASE_OUT):
        assert ease(0.0) == pytest.approx(0.0, abs=1e-6)
        assert ease(1.0) == pytest.approx(1.0, abs=1e-6)
        samples = [ease(t / 20) for t in range(21)]
        assert all(b >= a - 1e-9 for a, b in zip(samples, samples[1:])), "must be monotonic"
    # Entrance eases in and out; exit leaves immediately and decelerates.
    assert theme.EASE_IN(0.1) < 0.1
    assert theme.EASE_OUT(0.1) > 0.1


def test_theme_imports_without_manim():
    # The whole module graph under theme must stay import-clean headlessly.
    assert theme.get_palette("cool").bg.startswith("#")


def _rgb(value: str) -> tuple[int, int, int]:
    return tuple(int(value[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def _luma(value: str) -> float:
    r, g, b = _rgb(value)
    return 0.299 * r + 0.587 * g + 0.114 * b
