import { createTheme } from '@mui/material/styles'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#5b3927',
      dark: '#392317',
      light: '#8a6248',
      contrastText: '#fffaf4',
    },
    secondary: {
      main: '#b87945',
      contrastText: '#24170f',
    },
    background: {
      default: '#f8f5f0',
      paper: '#fffdf9',
    },
    text: {
      primary: '#28231f',
      secondary: '#70665d',
    },
    divider: '#e9e1d8',
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Manrope", "Segoe UI", sans-serif',
    h1: {
      fontSize: 'clamp(2.4rem, 7vw, 4.5rem)',
      fontWeight: 700,
      lineHeight: 1.05,
      letterSpacing: '-0.035em',
    },
    h2: {
      fontSize: 'clamp(1.85rem, 4.5vw, 3rem)',
      fontWeight: 700,
      letterSpacing: '-0.025em',
      lineHeight: 1.12,
    },
    h3: {
      fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)',
      lineHeight: 1.2,
    },
    h4: {
      fontSize: 'clamp(1.3rem, 2.7vw, 1.85rem)',
      lineHeight: 1.25,
    },
    button: {
      fontWeight: 700,
      textTransform: 'none',
    },
  },
  components: {
    MuiFormControl: {
      defaultProps: {
        fullWidth: true,
      },
      styleOverrides: {
        root: {
          minWidth: 0,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        fullWidth: true,
      },
      styleOverrides: {
        root: {
          minWidth: 0,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          minWidth: 0,
          minHeight: 36,
          maxWidth: '100%',
          boxSizing: 'border-box',
          paddingInline: 14,
          lineHeight: 1.25,
          fontSize: '0.875rem',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          '@media (max-width: 599.95px)': {
            paddingInline: 10,
          },
        },
        sizeSmall: {
          minHeight: 32,
          paddingInline: 10,
          fontSize: '0.8125rem',
        },
        startIcon: { flexShrink: 0 },
        endIcon: { flexShrink: 0 },
      },
    },
    MuiContainer: {
      styleOverrides: {
        root: {
          '@media (max-width: 599.95px)': {
            paddingInline: 16,
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          minWidth: 0,
          alignItems: 'flex-start',
        },
        message: {
          minWidth: 0,
          overflowWrap: 'anywhere',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          maxWidth: '100%',
        },
        label: {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          flexWrap: 'wrap',
          rowGap: 8,
          columnGap: 8,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          maxWidth: 'min(100% - 32px, 600px)',
          '@media (max-width: 599.95px)': {
            margin: 16,
            width: 'calc(100% - 32px)',
            maxWidth: 'none',
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minWidth: 0,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minWidth: 0,
          '@media (max-width: 599.95px)': {
            paddingInline: 12,
            fontSize: '0.8125rem',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: {
          borderColor: 'rgba(91, 57, 39, 0.14)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          transition: 'border-color 160ms ease, box-shadow 160ms ease',
          '&.MuiPaper-outlined:hover': {
            borderColor: 'rgba(91, 57, 39, 0.3)',
            boxShadow: '0 8px 24px rgba(57, 35, 23, 0.07)',
          },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 18,
          '&:last-child': { paddingBottom: 18 },
          '@media (max-width: 599.95px)': {
            padding: 16,
            '&:last-child': { paddingBottom: 16 },
          },
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          border: '1px solid rgba(91, 57, 39, 0.12)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '11px 14px',
          whiteSpace: 'nowrap',
          verticalAlign: 'middle',
          borderColor: 'rgba(91, 57, 39, 0.09)',
        },
        head: {
          backgroundColor: '#f3eee8',
          color: '#55483e',
          fontSize: '0.75rem',
          fontWeight: 800,
          letterSpacing: '0.035em',
        },
        footer: {
          backgroundColor: '#f8f5f0',
          fontWeight: 800,
        },
        sizeSmall: {
          padding: '9px 12px',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-child td, &:last-child th': { borderBottom: 0 },
        },
      },
    },
    MuiTable: {
      styleOverrides: {
        root: {
          '& .MuiTableBody-root .MuiTableRow-root:hover': {
            backgroundColor: 'rgba(91, 57, 39, 0.035)',
          },
        },
      },
    },
  },
})

export default theme
