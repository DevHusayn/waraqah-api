import React from 'react';
import {
    Body,
    Container,
    Head,
    Hr,
    Html,
    Img,
    Link,
    Preview,
    Section,
    Text,
} from '@react-email/components';
import { BRAND, getWebsiteUrl } from '../config.js';
import { buildClientEmailBranding } from '../helpers/clientEmailBranding.js';

const WARAQAH_SIGNUP_URL = 'https://mywaraqah.com';

/**
 * Layout for client-facing invoice emails — branded by the sender's business.
 *
 * @param {object} props
 * @param {string} props.preview - Inbox preview text
 * @param {object} props.branding - Business branding tokens
 * @param {React.ReactNode} props.children - Email body content
 */
export default function ClientEmailLayout({ preview, branding, children }) {
    const brand = branding || buildClientEmailBranding(null, 'Your business');
    const styles = createClientEmailStyles(brand);
    const waraqahUrl = getWebsiteUrl();

    return React.createElement(
        Html,
        null,
        React.createElement(Head, null),
        preview ? React.createElement(Preview, null, preview) : null,
        React.createElement(
            Body,
            { style: styles.body },
            React.createElement(
                Container,
                { style: styles.container },
                React.createElement(
                    Section,
                    { style: styles.header },
                    brand.logoUrl
                        ? React.createElement(Img, {
                            src: brand.logoUrl,
                            alt: brand.businessName,
                            width: 140,
                            height: 40,
                            style: styles.logo,
                        })
                        : React.createElement(Text, { style: styles.logoText }, brand.businessName),
                ),
                React.createElement(Section, { style: styles.content }, children),
                React.createElement(Hr, { style: styles.divider }),
                React.createElement(
                    Section,
                    { style: styles.footer },
                    React.createElement(
                        Text,
                        { style: styles.footerText },
                        'Powered by ',
                        React.createElement(Link, { href: waraqahUrl, style: styles.footerLink }, 'Waraqah'),
                    ),
                    React.createElement(
                        Text,
                        { style: styles.footerMuted },
                        'Need a professional way to invoice your own clients? ',
                        React.createElement(
                            Link,
                            { href: WARAQAH_SIGNUP_URL, style: styles.footerLink },
                            'Create your free account',
                        ),
                    ),
                ),
            ),
        ),
    );
}

export function createClientEmailStyles(brand) {
    const accent = brand.brandColor || BRAND.accent;
    const accentDark = brand.accentDark || BRAND.accentDark;
    const accentLight = brand.accentLight || BRAND.accentLight;

    return {
        body: {
            backgroundColor: BRAND.background,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            margin: 0,
            padding: '32px 16px',
        },
        container: {
            backgroundColor: BRAND.surface,
            border: `1px solid ${BRAND.border}`,
            borderRadius: '16px',
            margin: '0 auto',
            maxWidth: '560px',
            overflow: 'hidden',
        },
        header: {
            backgroundColor: accentLight,
            borderBottom: `3px solid ${accent}`,
            padding: '24px 32px',
            textAlign: 'center',
        },
        logo: {
            margin: '0 auto',
            display: 'block',
        },
        logoText: {
            margin: 0,
            fontSize: '22px',
            fontWeight: 700,
            color: accentDark,
        },
        content: {
            padding: '32px',
        },
        divider: {
            borderColor: BRAND.border,
            margin: 0,
        },
        footer: {
            padding: '24px 32px',
            backgroundColor: BRAND.background,
        },
        footerText: {
            margin: '0 0 8px',
            fontSize: '13px',
            lineHeight: '1.5',
            color: BRAND.textMuted,
            textAlign: 'center',
        },
        footerMuted: {
            margin: 0,
            fontSize: '12px',
            lineHeight: '1.5',
            color: BRAND.textLight,
            textAlign: 'center',
        },
        footerLink: {
            color: BRAND.accentDark,
            textDecoration: 'underline',
        },
        heading: {
            margin: '0 0 12px',
            fontSize: '24px',
            fontWeight: 700,
            color: BRAND.text,
            lineHeight: '1.3',
        },
        paragraph: {
            margin: '0 0 16px',
            fontSize: '15px',
            lineHeight: '1.6',
            color: BRAND.textMuted,
        },
        muted: {
            margin: '0 0 16px',
            fontSize: '13px',
            lineHeight: '1.5',
            color: BRAND.textLight,
        },
        button: {
            backgroundColor: accent,
            borderRadius: '10px',
            color: BRAND.surface,
            display: 'inline-block',
            fontSize: '15px',
            fontWeight: 600,
            lineHeight: '1',
            padding: '14px 28px',
            textDecoration: 'none',
            textAlign: 'center',
        },
        buttonSection: {
            margin: '24px 0',
            textAlign: 'center',
        },
        detailBox: {
            backgroundColor: BRAND.background,
            border: `1px solid ${BRAND.border}`,
            borderRadius: '12px',
            margin: '24px 0',
            padding: '20px 24px',
        },
        detailLabel: {
            margin: '0 0 4px',
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: BRAND.textLight,
        },
        detailValue: {
            margin: '0 0 16px',
            fontSize: '16px',
            fontWeight: 600,
            color: BRAND.text,
        },
        detailValueLast: {
            margin: 0,
            fontSize: '16px',
            fontWeight: 600,
            color: BRAND.text,
        },
        link: {
            color: accentDark,
            textDecoration: 'underline',
            wordBreak: 'break-all',
        },
    };
}
