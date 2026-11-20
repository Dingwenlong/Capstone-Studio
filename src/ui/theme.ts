import { createTheme, TextInput, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core'
import type { StudioThemeId } from '../shared/studio-theme'

const pine: MantineColorsTuple = [
  '#eef6ed', '#e4ead6', '#ccdcbf', '#aac6a9', '#85ad8e',
  '#63967a', '#4c7e67', '#356957', '#1f5548', '#123d33',
]

type Palette = {
  bg: string
  surface: string
  ink: string
  text: string
  muted: string
  border: string
  selected: string
  selectedText: string
  subtle: string
  media: string
  focus: string
  accentText: string
  header?: { bg: string; text: string; border: string }
  rail?: { bg: string; text: string; muted: string; border: string; selected: string; selectedText: string }
  viewer?: { bg: string; text: string; muted: string; border: string }
}

const font = 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif'
const baseTheme = createTheme({
  fontFamily: font,
  headings: { fontFamily: font, fontWeight: '730' },
  defaultRadius: 'md',
  radius: { md: '10px' },
  cursorType: 'pointer',
  autoContrast: true,
  components: {
    // Keep the field label separate from the native required state.
    TextInput: TextInput.extend({ defaultProps: { withAsterisk: false } }),
  },
})

function appearance(name: [string, string], palette: Palette, colors: MantineColorsTuple, shade: 4 | 8 = 8) {
  const { bg, surface, ink, text, muted, border, selected, selectedText, subtle, media, focus, accentText } = palette
  const header = palette.header ?? { bg: surface, text: ink, border }
  const rail = palette.rail ?? { bg: surface, text: ink, muted, border, selected, selectedText }
  const viewer = palette.viewer ?? { bg: '#192923', text: '#f5f8f3', muted: '#bbccc3', border: '#43554c' }
  const accent = colors[shade]
  const variables: CSSVariablesResolver = () => ({
    variables: {
      '--studio-bg': bg,
      '--studio-surface': surface,
      '--studio-ink': ink,
      '--studio-text': text,
      '--studio-muted': muted,
      '--studio-border': border,
      '--studio-selected': selected,
      '--studio-selected-text': selectedText,
      '--studio-accent': accent,
      '--studio-accent-text': accentText,
      '--studio-focus': focus,
      '--studio-header-bg': header.bg,
      '--studio-header-text': header.text,
      '--studio-header-border': header.border,
      '--studio-rail-bg': rail.bg,
      '--studio-rail-text': rail.text,
      '--studio-rail-muted': rail.muted,
      '--studio-rail-border': rail.border,
      '--studio-rail-selected': rail.selected,
      '--studio-rail-selected-text': rail.selectedText,
      '--studio-surface-subtle': subtle,
      '--studio-media-bg': media,
      '--studio-viewer-bg': viewer.bg,
      '--studio-viewer-text': viewer.text,
      '--studio-viewer-muted': viewer.muted,
      '--studio-viewer-border': viewer.border,
      '--studio-hero-cta': colors[1],
      '--studio-hero-cta-text': ink,
      '--studio-hero-cta-hover': colors[0],
    },
    light: {
      '--mantine-color-body': surface,
      '--mantine-color-text': text,
      '--mantine-color-dimmed': muted,
      '--mantine-color-placeholder': muted,
      '--mantine-color-default': surface,
      '--mantine-color-default-border': border,
      '--mantine-color-default-hover': subtle,
      '--mantine-color-anchor': ink,
      '--mantine-color-studio-outline': ink,
      '--mantine-color-studio-light-color': selectedText,
      '--mantine-color-studio-light': selected,
      '--mantine-color-studio-light-hover': selected,
      '--mantine-color-studio-filled-hover': colors[shade + 1],
    },
    dark: {},
  })

  return {
    name,
    variables,
    preview: { header: header.bg, rail: rail.bg, surface, accent },
    theme: createTheme({ ...baseTheme, colors: { pine, studio: colors }, primaryColor: 'studio', primaryShade: shade }),
  }
}

export const studioThemes = {
  'paper-pine': appearance(['纸白与松绿', 'Paper & Pine'], {
    bg: '#f6f4ed', surface: '#fffdf8', ink: '#123d33', text: '#1a302b', muted: '#536760',
    border: '#c8d2c5', selected: '#e4ead6', selectedText: '#123d33',
    subtle: '#edf0e5', media: '#edf0e8', focus: '#356957', accentText: '#fff',
  }, pine),
  'ink-blue': appearance(['墨蓝', 'Ink & Blue'], {
    bg: '#eaf1fb', surface: '#f6f9ff', ink: '#162748', text: '#23334e', muted: '#4d6080',
    border: '#c5d3e7', selected: '#e2ebff', selectedText: '#183c96',
    subtle: '#eaf0fa', media: '#e5edfa', focus: '#2554d7', accentText: '#fff',
    header: { bg: '#fff', text: '#162748', border: '#c5d3e7' },
    rail: {
      bg: '#fff', text: '#162748', muted: '#4d6080', border: '#c5d3e7',
      selected: '#e2ebff', selectedText: '#183c96',
    },
    viewer: { bg: '#18253b', text: '#f3f7ff', muted: '#c6d4ea', border: '#485a78' },
  }, ['#edf4ff', '#e1eaff', '#ccdcff', '#aabfff', '#829eff', '#5c7ef6', '#4667e9', '#3057dc', '#254bd2', '#1d39a9']),
  'graphite-lime': appearance(['石墨青柠', 'Graphite & Lime'], {
    bg: '#e8ebe4', surface: '#f5f6f2', ink: '#222e20', text: '#252d25', muted: '#4b564a',
    border: '#c5cec1', selected: '#e3efce', selectedText: '#26361f',
    subtle: '#e8ece3', media: '#e4e9e0', focus: '#536c31', accentText: '#1b2415',
    header: { bg: '#eef1ea', text: '#222e20', border: '#c5cec1' },
    rail: {
      bg: '#1d221e', text: '#f2f5ee', muted: '#c2cbbf', border: '#3a453a',
      selected: '#d4ec78', selectedText: '#1b2415',
    },
    viewer: { bg: '#1d221e', text: '#f3f7ed', muted: '#c2cbbf', border: '#4a5948' },
  }, ['#f4fae3', '#e8f5c0', '#e0f1a5', '#daef91', '#d4ec78', '#c7e365', '#a9c34b', '#819a38', '#61762e', '#40521e'], 4),
  'charcoal-indigo': appearance(['炭灰靛紫', 'Charcoal & Indigo'], {
    bg: '#eaeaf2', surface: '#fbfaff', ink: '#282444', text: '#252238', muted: '#58546c',
    border: '#d0cce1', selected: '#ede5fb', selectedText: '#4f2c9a',
    subtle: '#f0edf7', media: '#eceaf6', focus: '#6944bc', accentText: '#fff',
    header: { bg: '#262531', text: '#fbf9ff', border: '#454253' },
    rail: {
      bg: '#f2f0f8', text: '#282444', muted: '#58546c', border: '#d0cce1',
      selected: '#e9defa', selectedText: '#4f2c9a',
    },
    viewer: { bg: '#262531', text: '#f8f5ff', muted: '#cec8e5', border: '#555067' },
  }, ['#f7f1ff', '#efe4fd', '#e3d2fb', '#cfb6f5', '#b799ed', '#a280e3', '#8964d7', '#7750cf', '#6942c0', '#572da7']),
} satisfies Record<StudioThemeId, ReturnType<typeof appearance>>
