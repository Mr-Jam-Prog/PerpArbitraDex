/**
 * PerpArbitraDEX Tailwind Configuration
 * Design System Principles:
 * 1. Risk-aware color palette (green/yellow/red)
 * 2. Trading-optimized spacing
 * 3. No hover effects on critical buttons
 * 4. Monospace fonts for numbers
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      './pages/**/*.{js,ts,jsx,tsx,mdx}',
      './components/**/*.{js,ts,jsx,tsx,mdx}',
      './app/**/*.{js,ts,jsx,tsx,mdx}',
      './src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    
    // Enforce dark mode only
    darkMode: 'class',
    
    theme: {
      extend: {
        // ========== COLORS (Risk-Aware) ==========
        colors: {
          // Background colors
          background: {
            DEFAULT: '#0a0b0d',
            surface: '#111827',
            elevated: '#1f2937',
            overlay: 'rgba(0, 0, 0, 0.8)',
          },
          
          // Border colors
          border: {
            DEFAULT: '#374151',
            light: '#4b5563',
            dark: '#1f2937',
          },
          
          // Text colors
          text: {
            primary: '#e8e9ea',
            secondary: '#a0a1a3',
            tertiary: '#6b7280',
            inverse: '#0a0b0d',
          },
          
          // Risk colors (WCAG AA+ compliant)
          risk: {
            // Success/Green
            success: {
              light: '#10b981',
              DEFAULT: '#10b981',
              dark: '#0d966c',
              bg: 'rgba(16, 185, 129, 0.1)',
            },
            
            // Warning/Yellow
            warning: {
              light: '#f59e0b',
              DEFAULT: '#f59e0b',
              dark: '#d97706',
              bg: 'rgba(245, 158, 11, 0.1)',
            },
            
            // Danger/Red
            danger: {
              light: '#ef4444',
              DEFAULT: '#ef4444',
              dark: '#dc2626',
              bg: 'rgba(239, 68, 68, 0.1)',
            },
            
            // Info/Blue
            info: {
              light: '#3b82f6',
              DEFAULT: '#3b82f6',
              dark: '#2563eb',
              bg: 'rgba(59, 130, 246, 0.1)',
            },
          },
          
          // Status colors
          status: {
            long: '#10b981',
            short: '#ef4444',
            liquidated: '#f59e0b',
            closed: '#6b7280',
          },
          
          // Health factor gradient
          health: {
            safe: '#10b981',
            warning: '#f59e0b',
            danger: '#ef4444',
            critical: '#dc2626',
          },
        },
        
        // ========== TYPOGRAPHY ==========
        fontFamily: {
          // Primary font for UI
          sans: [
            'Inter',
            '-apple-system',
            'BlinkMacSystemFont',
            'Segoe UI',
            'Roboto',
            'sans-serif'
          ],
          
          // Monospace for all numbers (CRITICAL)
          mono: [
            'Roboto Mono',
            'SF Mono',
            'Monaco',
            'Inconsolata',
            'monospace'
          ],
        },
        
        fontSize: {
          // Trading-optimized font sizes
          'trading-xs': '0.6875rem',   // 11px
          'trading-sm': '0.75rem',     // 12px
          'trading-base': '0.875rem',  // 14px
          'trading-lg': '1rem',        // 16px
          'trading-xl': '1.125rem',    // 18px
          'trading-2xl': '1.25rem',    // 20px
          'trading-3xl': '1.5rem',     // 24px
          'trading-4xl': '2rem',       // 32px
        },
        
        lineHeight: {
          'trading-tight': '1.25',
          'trading-snug': '1.375',
          'trading-normal': '1.5',
        },
        
        // ========== SPACING (Trading Optimized) ==========
        spacing: {
          'trading-1': '0.125rem',   // 2px
          'trading-2': '0.25rem',    // 4px
          'trading-3': '0.375rem',   // 6px
          'trading-4': '0.5rem',     // 8px
          'trading-6': '0.75rem',    // 12px
          'trading-8': '1rem',       // 16px
          'trading-12': '1.5rem',    // 24px
          'trading-16': '2rem',      // 32px
          'trading-20': '2.5rem',    // 40px
          'trading-24': '3rem',      // 48px
          'trading-32': '4rem',      // 64px
        },
        
        // ========== BORDERS ==========
        borderWidth: {
          '1': '1px',
          '2': '2px',
          '3': '3px',
          '4': '4px',
        },
        
        borderRadius: {
          'trading-sm': '0.25rem',   // 4px
          'trading': '0.375rem',     // 6px
          'trading-md': '0.5rem',    // 8px
          'trading-lg': '0.75rem',   // 12px
          'trading-xl': '1rem',      // 16px
        },
        
        // ========== BREAKPOINTS (Trading Desk) ==========
        screens: {
          // Mobile first
          'xs': '375px',     // Small phones
          'sm': '640px',     // Tablets
          'md': '768px',     // Small laptops
          'lg': '1024px',    // Standard laptops
          'xl': '1280px',    // Large screens
          '2xl': '1536px',   // Trading desks
          '3xl': '1920px',   // Ultra-wide
          '4k': '2560px',    // 4K displays
          
          // Trading-specific breakpoints
          'trading-sm': '900px',   // Minimum for trading interface
          'trading-md': '1200px',  // Comfortable trading
          'trading-lg': '1600px',  // Professional setup
          'trading-xl': '2000px',  // Multi-monitor
        },
        
        // ========== ANIMATIONS (Restricted) ==========
        animation: {
          // No animations for price data
          'none': 'none',
          
          // Only minimal UI animations allowed
          'fade-in': 'fadeIn 150ms ease-out',
          'fade-out': 'fadeOut 150ms ease-out',
          'slide-up': 'slideUp 200ms ease-out',
          'slide-down': 'slideDown 200ms ease-out',
          
          // Skeleton loading (disabled for price data)
          'skeleton': 'skeleton 1.5s ease-in-out infinite',
        },
        
        keyframes: {
          fadeIn: {
            '0%': { opacity: '0' },
            '100%': { opacity: '1' },
          },
          fadeOut: {
            '0%': { opacity: '1' },
            '100%': { opacity: '0' },
          },
          slideUp: {
            '0%': { transform: 'translateY(0.5rem)', opacity: '0' },
            '100%': { transform: 'translateY(0)', opacity: '1' },
          },
          slideDown: {
            '0%': { transform: 'translateY(-0.5rem)', opacity: '0' },
            '100%': { transform: 'translateY(0)', opacity: '1' },
          },
          skeleton: {
            '0%': { backgroundPosition: '200% 0' },
            '100%': { backgroundPosition: '-200% 0' },
          },
        },
        
        transitionProperty: {
          // Restricted transitions
          'colors': 'background-color, border-color, color, fill, stroke',
          'opacity': 'opacity',
          'transform': 'transform',
          'none': 'none',
        },
        
        transitionDuration: {
          '150': '150ms',
          '200': '200ms',
          '300': '300ms',
          '500': '500ms',
        },
        
        // ========== GRID & FLEX ==========
        gridTemplateColumns: {
          // Trading layouts
          'trading-sm': '1fr',
          'trading-md': '1fr 300px',
          'trading-lg': '1fr 350px',
          'trading-xl': '1fr 400px',
          
          // Order book
          'orderbook': '1fr auto 1fr',
          
          // Market depth
          'market-depth': 'repeat(10, 1fr)',
        },
        
        gridTemplateRows: {
          // Trading layouts
          'trading-sm': 'auto 1fr auto',
          'trading-md': 'auto 1fr auto',
          'trading-lg': 'auto 1fr',
        },
        
        // ========== OPACITY ==========
        opacity: {
          '15': '0.15',
          '35': '0.35',
          '65': '0.65',
          '85': '0.85',
        },
        
        // ========== Z-INDEX (Trading Stacking) ==========
        zIndex: {
          // Base layers
          '0': '0',
          '1': '1',
          '10': '10',
          
          // UI elements
          'dropdown': '100',
          'sticky': '200',
          'fixed': '300',
          
          // Overlays
          'overlay': '400',
          'modal': '500',
          'popover': '600',
          'tooltip': '700',
          
          // Emergency
          'emergency': '9999',
        },
        
        // ========== SHADOWS ==========
        boxShadow: {
          // Minimal shadows for depth
          'trading-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          'trading': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
          'trading-md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          'trading-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          
          // Inner shadows
          'inner-trading': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
          
          // Glows for warnings
          'glow-success': '0 0 0 3px rgba(16, 185, 129, 0.1)',
          'glow-warning': '0 0 0 3px rgba(245, 158, 11, 0.1)',
          'glow-danger': '0 0 0 3px rgba(239, 68, 68, 0.1)',
          'glow-info': '0 0 0 3px rgba(59, 130, 246, 0.1)',
        },
        
        // ========== CUSTOM UTILITIES ==========
        // Will be added via plugins
      },
    },
    
    plugins: [
      // Custom plugin to enforce trading rules
      function({ addUtilities, addComponents, theme }) {
        
        // ========== CRITICAL TRADING UTILITIES ==========
        const criticalUtilities = {
          // Disable transitions on price elements
          '.price-no-transition': {
            transition: 'none !important',
            animation: 'none !important',
          },
          
          // Monospace numbers (enforced)
          '.number-mono': {
            fontFamily: theme('fontFamily.mono'),
            fontVariantNumeric: 'tabular-nums',
          },
          
          // No hover effects on critical buttons
          '.btn-critical': {
            '&:hover': {
              transform: 'none !important',
              boxShadow: 'none !important',
            },
          },
          
          // Will-change for performance
          '.will-change-contents': {
            willChange: 'contents',
          },
          
          // Containment for isolation
          '.contain-content': {
            contain: 'content',
          },
          
          // Hardware acceleration
          '.transform-gpu': {
            transform: 'translateZ(0)',
          },
        };
        
        // ========== RISK COLOR UTILITIES ==========
        const riskUtilities = {
          // PnL colors
          '.pnl-positive': {
            color: theme('colors.risk.success.DEFAULT'),
          },
          '.pnl-negative': {
            color: theme('colors.risk.danger.DEFAULT'),
          },
          '.pnl-neutral': {
            color: theme('colors.text.secondary'),
          },
          
          // Health factor colors
          '.health-safe': {
            color: theme('colors.health.safe'),
          },
          '.health-warning': {
            color: theme('colors.health.warning'),
          },
          '.health-danger': {
            color: theme('colors.health.danger'),
          },
          '.health-critical': {
            color: theme('colors.health.critical'),
          },
          
          // Funding rate colors
          '.funding-positive': {
            color: theme('colors.risk.success.DEFAULT'),
            backgroundColor: theme('colors.risk.success.bg'),
          },
          '.funding-negative': {
            color: theme('colors.risk.danger.DEFAULT'),
            backgroundColor: theme('colors.risk.danger.bg'),
          },
          
          // Position type colors
          '.position-long': {
            color: theme('colors.status.long'),
          },
          '.position-short': {
            color: theme('colors.status.short'),
          },
        };
        
        // ========== TRADING COMPONENTS ==========
        const tradingComponents = {
          // Trading card
          '.trading-card': {
            backgroundColor: theme('colors.background.surface'),
            border: `1px solid ${theme('colors.border.DEFAULT')}`,
            borderRadius: theme('borderRadius.trading-md'),
            padding: theme('spacing.trading-8'),
          },
          
          // Order form
          '.order-form': {
            '& input[type="number"]': {
              fontFamily: theme('fontFamily.mono'),
            },
            '& button[type="submit"]': {
              transition: 'none',
            },
          },
          
          // Market depth bar
          '.market-depth-bar': {
            transition: 'none',
            '&.bid': {
              backgroundColor: theme('colors.risk.success.bg'),
            },
            '&.ask': {
              backgroundColor: theme('colors.risk.danger.bg'),
            },
          },
          
          // Emergency overlay
          '.emergency-overlay': {
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            pointerEvents: 'none',
            zIndex: theme('zIndex.emergency'),
          },
        };
        
        addUtilities(criticalUtilities);
        addUtilities(riskUtilities);
        addComponents(tradingComponents);
      },
      
      // Additional plugins
      require('@tailwindcss/forms'),     // Form styling
      require('@tailwindcss/typography'), // Prose styling for docs
    ],
    
    // ========== SAFELIST (Critical classes) ==========
    safelist: [
      // Risk colors
      'pnl-positive',
      'pnl-negative',
      'pnl-neutral',
      'health-safe',
      'health-warning',
      'health-danger',
      'health-critical',
      'funding-positive',
      'funding-negative',
      'position-long',
      'position-short',
      
      // Animation restrictions
      'price-no-transition',
      
      // Font utilities
      'font-mono',
      'number-mono',
    ],
    
    // ========== CORE PLUGINS ==========
    corePlugins: {
      // Disable unnecessary plugins for trading UI
      float: false,
      clear: false,
      skew: false,
      backdropBlur: false,
      backdropBrightness: false,
      backdropContrast: false,
      backdropGrayscale: false,
      backdropHueRotate: false,
      backdropInvert: false,
      backdropOpacity: false,
      backdropSaturate: false,
      backdropSepia: false,
      blur: false,
      brightness: false,
      contrast: false,
      grayscale: false,
      hueRotate: false,
      invert: false,
      saturate: false,
      sepia: false,
      filter: false,
    },
  };