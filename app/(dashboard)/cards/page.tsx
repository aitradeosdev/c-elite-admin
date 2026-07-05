'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  PageHeader, Card as UICard, CardBody, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, FieldShell, Toggle, Modal, SidePanel,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { StatusDot, StatStrip } from '../_shared/statusUi';

const ISO_COUNTRIES = [
  { code: 'AF', name: 'Afghanistan', symbol: '؋', currency: 'AFN' },
  { code: 'AL', name: 'Albania', symbol: 'L', currency: 'ALL' },
  { code: 'DZ', name: 'Algeria', symbol: 'DA', currency: 'DZD' },
  { code: 'AS', name: 'American Samoa', symbol: '$', currency: 'USD' },
  { code: 'AD', name: 'Andorra', symbol: '€', currency: 'EUR' },
  { code: 'AO', name: 'Angola', symbol: 'Kz', currency: 'AOA' },
  { code: 'AI', name: 'Anguilla', symbol: 'EC$', currency: 'XCD' },
  { code: 'AG', name: 'Antigua and Barbuda', symbol: 'EC$', currency: 'XCD' },
  { code: 'AR', name: 'Argentina', symbol: '$', currency: 'ARS' },
  { code: 'AM', name: 'Armenia', symbol: '֏', currency: 'AMD' },
  { code: 'AW', name: 'Aruba', symbol: 'ƒ', currency: 'AWG' },
  { code: 'AU', name: 'Australia', symbol: 'A$', currency: 'AUD' },
  { code: 'AT', name: 'Austria', symbol: '€', currency: 'EUR' },
  { code: 'AZ', name: 'Azerbaijan', symbol: '₼', currency: 'AZN' },
  { code: 'BS', name: 'Bahamas', symbol: 'B$', currency: 'BSD' },
  { code: 'BH', name: 'Bahrain', symbol: 'BD', currency: 'BHD' },
  { code: 'BD', name: 'Bangladesh', symbol: '৳', currency: 'BDT' },
  { code: 'BB', name: 'Barbados', symbol: 'Bds$', currency: 'BBD' },
  { code: 'BY', name: 'Belarus', symbol: 'Br', currency: 'BYN' },
  { code: 'BE', name: 'Belgium', symbol: '€', currency: 'EUR' },
  { code: 'BZ', name: 'Belize', symbol: 'BZ$', currency: 'BZD' },
  { code: 'BJ', name: 'Benin', symbol: 'CFA', currency: 'XOF' },
  { code: 'BM', name: 'Bermuda', symbol: 'BD$', currency: 'BMD' },
  { code: 'BT', name: 'Bhutan', symbol: 'Nu', currency: 'BTN' },
  { code: 'BO', name: 'Bolivia', symbol: 'Bs', currency: 'BOB' },
  { code: 'BA', name: 'Bosnia and Herzegovina', symbol: 'KM', currency: 'BAM' },
  { code: 'BW', name: 'Botswana', symbol: 'P', currency: 'BWP' },
  { code: 'BR', name: 'Brazil', symbol: 'R$', currency: 'BRL' },
  { code: 'BN', name: 'Brunei', symbol: 'B$', currency: 'BND' },
  { code: 'BG', name: 'Bulgaria', symbol: 'лв', currency: 'BGN' },
  { code: 'BF', name: 'Burkina Faso', symbol: 'CFA', currency: 'XOF' },
  { code: 'BI', name: 'Burundi', symbol: 'FBu', currency: 'BIF' },
  { code: 'KH', name: 'Cambodia', symbol: '៛', currency: 'KHR' },
  { code: 'CM', name: 'Cameroon', symbol: 'FCF', currency: 'XAF' },
  { code: 'CA', name: 'Canada', symbol: 'C$', currency: 'CAD' },
  { code: 'CV', name: 'Cape Verde', symbol: 'Esc', currency: 'CVE' },
  { code: 'KY', name: 'Cayman Islands', symbol: 'CI$', currency: 'KYD' },
  { code: 'CF', name: 'Central African Republic', symbol: 'FCF', currency: 'XAF' },
  { code: 'TD', name: 'Chad', symbol: 'FCF', currency: 'XAF' },
  { code: 'CL', name: 'Chile', symbol: '$', currency: 'CLP' },
  { code: 'CN', name: 'China', symbol: '¥', currency: 'CNY' },
  { code: 'CO', name: 'Colombia', symbol: '$', currency: 'COP' },
  { code: 'KM', name: 'Comoros', symbol: 'CF', currency: 'KMF' },
  { code: 'CG', name: 'Congo', symbol: 'FCF', currency: 'XAF' },
  { code: 'CD', name: 'Congo (DRC)', symbol: 'FC', currency: 'CDF' },
  { code: 'CR', name: 'Costa Rica', symbol: '₡', currency: 'CRC' },
  { code: 'CI', name: 'Côte d’Ivoire', symbol: 'CFA', currency: 'XOF' },
  { code: 'HR', name: 'Croatia', symbol: '€', currency: 'EUR' },
  { code: 'CU', name: 'Cuba', symbol: '$', currency: 'CUP' },
  { code: 'CY', name: 'Cyprus', symbol: '€', currency: 'EUR' },
  { code: 'CZ', name: 'Czech Republic', symbol: 'Kč', currency: 'CZK' },
  { code: 'DK', name: 'Denmark', symbol: 'kr', currency: 'DKK' },
  { code: 'DJ', name: 'Djibouti', symbol: 'Fdj', currency: 'DJF' },
  { code: 'DM', name: 'Dominica', symbol: 'EC$', currency: 'XCD' },
  { code: 'DO', name: 'Dominican Republic', symbol: 'RD$', currency: 'DOP' },
  { code: 'EC', name: 'Ecuador', symbol: '$', currency: 'USD' },
  { code: 'EG', name: 'Egypt', symbol: 'E£', currency: 'EGP' },
  { code: 'SV', name: 'El Salvador', symbol: '$', currency: 'USD' },
  { code: 'GQ', name: 'Equatorial Guinea', symbol: 'FCF', currency: 'XAF' },
  { code: 'ER', name: 'Eritrea', symbol: 'Nfk', currency: 'ERN' },
  { code: 'EE', name: 'Estonia', symbol: '€', currency: 'EUR' },
  { code: 'SZ', name: 'Eswatini', symbol: 'E', currency: 'SZL' },
  { code: 'ET', name: 'Ethiopia', symbol: 'Br', currency: 'ETB' },
  { code: 'FJ', name: 'Fiji', symbol: 'FJ$', currency: 'FJD' },
  { code: 'FI', name: 'Finland', symbol: '€', currency: 'EUR' },
  { code: 'FR', name: 'France', symbol: '€', currency: 'EUR' },
  { code: 'GF', name: 'French Guiana', symbol: '€', currency: 'EUR' },
  { code: 'PF', name: 'French Polynesia', symbol: 'F', currency: 'XPF' },
  { code: 'GA', name: 'Gabon', symbol: 'FCF', currency: 'XAF' },
  { code: 'GM', name: 'Gambia', symbol: 'D', currency: 'GMD' },
  { code: 'GE', name: 'Georgia', symbol: '₾', currency: 'GEL' },
  { code: 'DE', name: 'Germany', symbol: '€', currency: 'EUR' },
  { code: 'GH', name: 'Ghana', symbol: '₵', currency: 'GHS' },
  { code: 'GI', name: 'Gibraltar', symbol: '£', currency: 'GIP' },
  { code: 'GR', name: 'Greece', symbol: '€', currency: 'EUR' },
  { code: 'GL', name: 'Greenland', symbol: 'kr', currency: 'DKK' },
  { code: 'GD', name: 'Grenada', symbol: 'EC$', currency: 'XCD' },
  { code: 'GP', name: 'Guadeloupe', symbol: '€', currency: 'EUR' },
  { code: 'GU', name: 'Guam', symbol: '$', currency: 'USD' },
  { code: 'GT', name: 'Guatemala', symbol: 'Q', currency: 'GTQ' },
  { code: 'GN', name: 'Guinea', symbol: 'FG', currency: 'GNF' },
  { code: 'GW', name: 'Guinea-Bissau', symbol: 'CFA', currency: 'XOF' },
  { code: 'GY', name: 'Guyana', symbol: 'G$', currency: 'GYD' },
  { code: 'HT', name: 'Haiti', symbol: 'G', currency: 'HTG' },
  { code: 'HN', name: 'Honduras', symbol: 'L', currency: 'HNL' },
  { code: 'HK', name: 'Hong Kong', symbol: 'HK$', currency: 'HKD' },
  { code: 'HU', name: 'Hungary', symbol: 'Ft', currency: 'HUF' },
  { code: 'IS', name: 'Iceland', symbol: 'kr', currency: 'ISK' },
  { code: 'IN', name: 'India', symbol: '₹', currency: 'INR' },
  { code: 'ID', name: 'Indonesia', symbol: 'Rp', currency: 'IDR' },
  { code: 'IR', name: 'Iran', symbol: '﷼', currency: 'IRR' },
  { code: 'IQ', name: 'Iraq', symbol: 'ID', currency: 'IQD' },
  { code: 'IE', name: 'Ireland', symbol: '€', currency: 'EUR' },
  { code: 'IL', name: 'Israel', symbol: '₪', currency: 'ILS' },
  { code: 'IT', name: 'Italy', symbol: '€', currency: 'EUR' },
  { code: 'JM', name: 'Jamaica', symbol: 'J$', currency: 'JMD' },
  { code: 'JP', name: 'Japan', symbol: '¥', currency: 'JPY' },
  { code: 'JO', name: 'Jordan', symbol: 'JD', currency: 'JOD' },
  { code: 'KZ', name: 'Kazakhstan', symbol: '₸', currency: 'KZT' },
  { code: 'KE', name: 'Kenya', symbol: 'KSh', currency: 'KES' },
  { code: 'KI', name: 'Kiribati', symbol: 'A$', currency: 'AUD' },
  { code: 'KP', name: 'North Korea', symbol: '₩', currency: 'KPW' },
  { code: 'KR', name: 'South Korea', symbol: '₩', currency: 'KRW' },
  { code: 'KW', name: 'Kuwait', symbol: 'KD', currency: 'KWD' },
  { code: 'KG', name: 'Kyrgyzstan', symbol: 'с', currency: 'KGS' },
  { code: 'LA', name: 'Laos', symbol: '₭', currency: 'LAK' },
  { code: 'LV', name: 'Latvia', symbol: '€', currency: 'EUR' },
  { code: 'LB', name: 'Lebanon', symbol: 'LL', currency: 'LBP' },
  { code: 'LS', name: 'Lesotho', symbol: 'L', currency: 'LSL' },
  { code: 'LR', name: 'Liberia', symbol: 'L$', currency: 'LRD' },
  { code: 'LY', name: 'Libya', symbol: 'LD', currency: 'LYD' },
  { code: 'LI', name: 'Liechtenstein', symbol: 'CHF', currency: 'CHF' },
  { code: 'LT', name: 'Lithuania', symbol: '€', currency: 'EUR' },
  { code: 'LU', name: 'Luxembourg', symbol: '€', currency: 'EUR' },
  { code: 'MO', name: 'Macau', symbol: 'MOP', currency: 'MOP' },
  { code: 'MG', name: 'Madagascar', symbol: 'Ar', currency: 'MGA' },
  { code: 'MW', name: 'Malawi', symbol: 'MK', currency: 'MWK' },
  { code: 'MY', name: 'Malaysia', symbol: 'RM', currency: 'MYR' },
  { code: 'MV', name: 'Maldives', symbol: 'Rf', currency: 'MVR' },
  { code: 'ML', name: 'Mali', symbol: 'CFA', currency: 'XOF' },
  { code: 'MT', name: 'Malta', symbol: '€', currency: 'EUR' },
  { code: 'MH', name: 'Marshall Islands', symbol: '$', currency: 'USD' },
  { code: 'MQ', name: 'Martinique', symbol: '€', currency: 'EUR' },
  { code: 'MR', name: 'Mauritania', symbol: 'UM', currency: 'MRU' },
  { code: 'MU', name: 'Mauritius', symbol: 'Rs', currency: 'MUR' },
  { code: 'MX', name: 'Mexico', symbol: '$', currency: 'MXN' },
  { code: 'FM', name: 'Micronesia', symbol: '$', currency: 'USD' },
  { code: 'MD', name: 'Moldova', symbol: 'L', currency: 'MDL' },
  { code: 'MC', name: 'Monaco', symbol: '€', currency: 'EUR' },
  { code: 'MN', name: 'Mongolia', symbol: '₮', currency: 'MNT' },
  { code: 'ME', name: 'Montenegro', symbol: '€', currency: 'EUR' },
  { code: 'MS', name: 'Montserrat', symbol: 'EC$', currency: 'XCD' },
  { code: 'MA', name: 'Morocco', symbol: 'DH', currency: 'MAD' },
  { code: 'MZ', name: 'Mozambique', symbol: 'MT', currency: 'MZN' },
  { code: 'MM', name: 'Myanmar', symbol: 'K', currency: 'MMK' },
  { code: 'NA', name: 'Namibia', symbol: 'N$', currency: 'NAD' },
  { code: 'NR', name: 'Nauru', symbol: 'A$', currency: 'AUD' },
  { code: 'NP', name: 'Nepal', symbol: 'Rs', currency: 'NPR' },
  { code: 'NL', name: 'Netherlands', symbol: '€', currency: 'EUR' },
  { code: 'NC', name: 'New Caledonia', symbol: 'F', currency: 'XPF' },
  { code: 'NZ', name: 'New Zealand', symbol: 'NZ$', currency: 'NZD' },
  { code: 'NI', name: 'Nicaragua', symbol: 'C$', currency: 'NIO' },
  { code: 'NE', name: 'Niger', symbol: 'CFA', currency: 'XOF' },
  { code: 'NG', name: 'Nigeria', symbol: '₦', currency: 'NGN' },
  { code: 'MK', name: 'North Macedonia', symbol: 'ден', currency: 'MKD' },
  { code: 'NO', name: 'Norway', symbol: 'kr', currency: 'NOK' },
  { code: 'OM', name: 'Oman', symbol: 'OR', currency: 'OMR' },
  { code: 'PK', name: 'Pakistan', symbol: 'Rs', currency: 'PKR' },
  { code: 'PW', name: 'Palau', symbol: '$', currency: 'USD' },
  { code: 'PS', name: 'Palestine', symbol: '₪', currency: 'ILS' },
  { code: 'PA', name: 'Panama', symbol: 'B/.', currency: 'PAB' },
  { code: 'PG', name: 'Papua New Guinea', symbol: 'K', currency: 'PGK' },
  { code: 'PY', name: 'Paraguay', symbol: '₲', currency: 'PYG' },
  { code: 'PE', name: 'Peru', symbol: 'S/', currency: 'PEN' },
  { code: 'PH', name: 'Philippines', symbol: '₱', currency: 'PHP' },
  { code: 'PL', name: 'Poland', symbol: 'zł', currency: 'PLN' },
  { code: 'PT', name: 'Portugal', symbol: '€', currency: 'EUR' },
  { code: 'PR', name: 'Puerto Rico', symbol: '$', currency: 'USD' },
  { code: 'QA', name: 'Qatar', symbol: 'QR', currency: 'QAR' },
  { code: 'RE', name: 'Réunion', symbol: '€', currency: 'EUR' },
  { code: 'RO', name: 'Romania', symbol: 'lei', currency: 'RON' },
  { code: 'RU', name: 'Russia', symbol: '₽', currency: 'RUB' },
  { code: 'RW', name: 'Rwanda', symbol: 'RF', currency: 'RWF' },
  { code: 'WS', name: 'Samoa', symbol: 'WS$', currency: 'WST' },
  { code: 'SM', name: 'San Marino', symbol: '€', currency: 'EUR' },
  { code: 'ST', name: 'São Tomé and Príncipe', symbol: 'Db', currency: 'STN' },
  { code: 'SA', name: 'Saudi Arabia', symbol: 'SAR', currency: 'SAR' },
  { code: 'SN', name: 'Senegal', symbol: 'CFA', currency: 'XOF' },
  { code: 'RS', name: 'Serbia', symbol: 'din', currency: 'RSD' },
  { code: 'SC', name: 'Seychelles', symbol: 'SR', currency: 'SCR' },
  { code: 'SL', name: 'Sierra Leone', symbol: 'Le', currency: 'SLE' },
  { code: 'SG', name: 'Singapore', symbol: 'S$', currency: 'SGD' },
  { code: 'SK', name: 'Slovakia', symbol: '€', currency: 'EUR' },
  { code: 'SI', name: 'Slovenia', symbol: '€', currency: 'EUR' },
  { code: 'SB', name: 'Solomon Islands', symbol: 'SI$', currency: 'SBD' },
  { code: 'SO', name: 'Somalia', symbol: 'Sh', currency: 'SOS' },
  { code: 'ZA', name: 'South Africa', symbol: 'R', currency: 'ZAR' },
  { code: 'SS', name: 'South Sudan', symbol: 'SS£', currency: 'SSP' },
  { code: 'ES', name: 'Spain', symbol: '€', currency: 'EUR' },
  { code: 'LK', name: 'Sri Lanka', symbol: 'Rs', currency: 'LKR' },
  { code: 'KN', name: 'Saint Kitts and Nevis', symbol: 'EC$', currency: 'XCD' },
  { code: 'LC', name: 'Saint Lucia', symbol: 'EC$', currency: 'XCD' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', symbol: 'EC$', currency: 'XCD' },
  { code: 'SD', name: 'Sudan', symbol: 'SDG', currency: 'SDG' },
  { code: 'SR', name: 'Suriname', symbol: 'Sr$', currency: 'SRD' },
  { code: 'SE', name: 'Sweden', symbol: 'kr', currency: 'SEK' },
  { code: 'CH', name: 'Switzerland', symbol: 'CHF', currency: 'CHF' },
  { code: 'SY', name: 'Syria', symbol: 'SP', currency: 'SYP' },
  { code: 'TW', name: 'Taiwan', symbol: 'NT$', currency: 'TWD' },
  { code: 'TJ', name: 'Tajikistan', symbol: 'SM', currency: 'TJS' },
  { code: 'TZ', name: 'Tanzania', symbol: 'TSh', currency: 'TZS' },
  { code: 'TH', name: 'Thailand', symbol: '฿', currency: 'THB' },
  { code: 'TL', name: 'Timor-Leste', symbol: '$', currency: 'USD' },
  { code: 'TG', name: 'Togo', symbol: 'CFA', currency: 'XOF' },
  { code: 'TO', name: 'Tonga', symbol: 'T$', currency: 'TOP' },
  { code: 'TT', name: 'Trinidad and Tobago', symbol: 'TT$', currency: 'TTD' },
  { code: 'TN', name: 'Tunisia', symbol: 'DT', currency: 'TND' },
  { code: 'TR', name: 'Turkey', symbol: '₺', currency: 'TRY' },
  { code: 'TM', name: 'Turkmenistan', symbol: 'T', currency: 'TMT' },
  { code: 'TC', name: 'Turks and Caicos', symbol: '$', currency: 'USD' },
  { code: 'TV', name: 'Tuvalu', symbol: 'A$', currency: 'AUD' },
  { code: 'UG', name: 'Uganda', symbol: 'USh', currency: 'UGX' },
  { code: 'UA', name: 'Ukraine', symbol: '₴', currency: 'UAH' },
  { code: 'AE', name: 'United Arab Emirates', symbol: 'AED', currency: 'AED' },
  { code: 'GB', name: 'United Kingdom', symbol: '£', currency: 'GBP' },
  { code: 'US', name: 'United States', symbol: '$', currency: 'USD' },
  { code: 'UY', name: 'Uruguay', symbol: '$U', currency: 'UYU' },
  { code: 'UZ', name: 'Uzbekistan', symbol: 'sum', currency: 'UZS' },
  { code: 'VU', name: 'Vanuatu', symbol: 'VT', currency: 'VUV' },
  { code: 'VA', name: 'Vatican City', symbol: '€', currency: 'EUR' },
  { code: 'VE', name: 'Venezuela', symbol: 'Bs', currency: 'VES' },
  { code: 'VN', name: 'Vietnam', symbol: '₫', currency: 'VND' },
  { code: 'VG', name: 'British Virgin Islands', symbol: '$', currency: 'USD' },
  { code: 'VI', name: 'U.S. Virgin Islands', symbol: '$', currency: 'USD' },
  { code: 'YE', name: 'Yemen', symbol: 'YR', currency: 'YER' },
  { code: 'ZM', name: 'Zambia', symbol: 'ZK', currency: 'ZMW' },
  { code: 'ZW', name: 'Zimbabwe', symbol: 'Z$', currency: 'ZWL' },
].sort((a, b) => a.name.localeCompare(b.name));

interface Country {
  id: string;
  country_code: string;
  country_name: string;
  currency_symbol: string;
  is_active: boolean;
}

interface Card {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  sort_order: number;
  countries: Country[];
}

function codeToFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  return code.toUpperCase().replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

function formatCountries(countries: Country[]) {
  if (!countries || countries.length === 0) return '-';
  const names = countries.map((c) => c.country_name);
  if (names.length <= 2) return names.join(', ');
  return names.slice(0, 2).join(', ') + '...';
}

function CardStatus({ active }: { active: boolean }) {
  return <StatusDot status={active ? 'Active' : 'Inactive'} tone={active ? 'success' : 'neutral'} />;
}

function CardLogo({ card, size = 32 }: { card: Card; size?: number }) {
  return card.logo_url
    ? <img src={card.logo_url} alt={card.name} style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4 }} />
    : <div style={{ width: size, height: size, background: 'var(--bg-subtle)', borderRadius: 4, flex: 'none' }} />;
}

function CardsMobile({
  cards, loading, onEdit, onCountries, onToggle,
}: {
  cards: Card[];
  loading: boolean;
  onEdit: (c: Card) => void;
  onCountries: (c: Card) => void;
  onToggle: (c: Card) => void;
}) {
  if (loading && cards.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map((k) => (
          <div key={k} style={{ height: 96, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', opacity: 0.5 }} />
        ))}
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
        No card brands yet
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {cards.map((card) => (
        <div key={card.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <CardLogo card={card} size={36} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--fg-primary)' }}>{card.name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 2 }}>
                  {card.countries.length} {card.countries.length === 1 ? 'country' : 'countries'} · sort {card.sort_order}
                </div>
              </div>
            </div>
            <CardStatus active={card.is_active} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={() => onEdit(card)}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={() => onCountries(card)}>Countries</Button>
            <Button variant="secondary" size="sm" onClick={() => onToggle(card)}>
              {card.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CardsPage() {
  const isMobile = useIsMobile();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCardModal, setShowCardModal] = useState(false);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [cardName, setCardName] = useState('');
  const [cardActive, setCardActive] = useState(true);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [countriesCard, setCountriesCard] = useState<Card | null>(null);
  const [newCountryCode, setNewCountryCode] = useState('');
  const [newCurrencySymbol, setNewCurrencySymbol] = useState('');
  const [newCurrencyName, setNewCurrencyName] = useState('');
  const [newCountryActive, setNewCountryActive] = useState(true);
  const [addingCountry, setAddingCountry] = useState(false);
  const addingCountryLockRef = useRef(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);
  const countryBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!countryOpen) return;
    const onClick = (e: MouseEvent) => {
      if (countryBoxRef.current && !countryBoxRef.current.contains(e.target as Node)) {
        setCountryOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [countryOpen]);

  useEffect(() => { fetchCards(); }, []);

  const fetchCards = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/cards');
    const data = await res.json();
    setCards(data.cards || []);
    if (!silent) setLoading(false);
  };

  const openCreate = () => {
    setEditCard(null);
    setCardName(''); setCardActive(true); setLogoUrl(''); setLogoPreview(''); setCardError('');
    setShowCardModal(true);
  };

  const openEdit = (card: Card) => {
    setEditCard(card);
    setCardName(card.name); setCardActive(card.is_active);
    setLogoUrl(card.logo_url || ''); setLogoPreview(card.logo_url || ''); setCardError('');
    setShowCardModal(true);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/cards/upload', { method: 'POST', body: formData });
    const data = await res.json();
    setUploading(false);
    if (data.url) { setLogoUrl(data.url); setLogoPreview(data.url); }
  };

  const handleSaveCard = async () => {
    if (!cardName.trim()) { setCardError('Card name is required.'); return; }
    setSaving(true);
    setCardError('');
    const method = editCard ? 'PATCH' : 'POST';
    const body = editCard
      ? { type: 'card', id: editCard.id, name: cardName, is_active: cardActive, logo_url: logoUrl || null }
      : { type: 'card', name: cardName, is_active: cardActive, logo_url: logoUrl || null };
    const res = await fetch('/api/cards', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setCardError(data.error || 'Failed to save.'); return; }
    setShowCardModal(false);
    fetchCards(true);
  };

  const handleToggleCard = async (card: Card) => {
    await fetch('/api/cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card', id: card.id, is_active: !card.is_active }),
    });
    fetchCards(true);
  };

  const openCountries = (card: Card) => {
    setCountriesCard(card);
    setNewCountryCode(''); setNewCurrencySymbol(''); setNewCurrencyName(''); setNewCountryActive(true);
  };

  const handleAddCountry = async () => {
    if (!newCountryCode || !newCurrencySymbol || !newCurrencyName) return;
    if (addingCountryLockRef.current) return;
    addingCountryLockRef.current = true;
    setAddingCountry(true);
    try {
      const countryName = ISO_COUNTRIES.find((c) => c.code === newCountryCode)?.name || newCountryCode;
      await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'country',
          card_id: countriesCard!.id,
          country_code: newCountryCode,
          country_name: countryName,
          currency_symbol: newCurrencySymbol,
          is_active: newCountryActive,
        }),
      });
      setNewCountryCode(''); setNewCurrencySymbol(''); setNewCurrencyName('');
      await fetchCards(true);
      setCountriesCard((prev) => {
        const updated = cards.find((c) => c.id === prev?.id);
        return updated || prev;
      });
    } finally {
      setAddingCountry(false);
      addingCountryLockRef.current = false;
    }
  };

  const handleToggleCountry = async (country: Country) => {
    await fetch('/api/cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'country', id: country.id, is_active: !country.is_active }),
    });
    fetchCards(true);
  };

  const handleRemoveCountry = async (country: Country) => {
    await fetch('/api/cards', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'country', id: country.id }),
    });
    fetchCards(true);
  };

  useEffect(() => {
    if (countriesCard) {
      const updated = cards.find((c) => c.id === countriesCard.id);
      if (updated) setCountriesCard(updated);
    }
  }, [cards]);

  const activeCount = cards.filter((c) => c.is_active).length;
  const filteredCountries = ISO_COUNTRIES.filter((c) =>
    c.name.toLowerCase().includes(countryQuery.toLowerCase()) ||
    c.code.toLowerCase().includes(countryQuery.toLowerCase()) ||
    c.currency.toLowerCase().includes(countryQuery.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Card & Country Management"
        subtitle="Configure gift-card brands and the countries each one is available in."
        actions={
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={openCreate}>
            Add Card Brand
          </Button>
        }
      />

      <StatStrip items={[
        { label: 'Total brands', value: cards.length.toLocaleString() },
        { label: 'Active', value: activeCount.toLocaleString() },
      ]} />

      {isMobile ? (
        <CardsMobile
          cards={cards}
          loading={loading}
          onEdit={openEdit}
          onCountries={openCountries}
          onToggle={handleToggleCard}
        />
      ) : (
        <UICard>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Logo</Th>
                  <Th>Card Name</Th>
                  <Th>Countries</Th>
                  <Th>Status</Th>
                  <Th align="right">Sort Order</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {loading ? (
                  <TableEmpty colSpan={6}>Loading…</TableEmpty>
                ) : cards.length === 0 ? (
                  <TableEmpty colSpan={6}>No card brands yet</TableEmpty>
                ) : cards.map((card) => (
                  <Tr key={card.id}>
                    <Td><CardLogo card={card} /></Td>
                    <Td emphasis="primary">{card.name}</Td>
                    <Td emphasis="secondary">{card.countries.length} ({formatCountries(card.countries)})</Td>
                    <Td><CardStatus active={card.is_active} /></Td>
                    <Td align="right" mono>{card.sort_order}</Td>
                    <Td align="right">
                      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(card)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => openCountries(card)}>Countries</Button>
                        <Button variant="secondary" size="sm" onClick={() => handleToggleCard(card)}>
                          {card.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <span style={{ fontSize: 16, color: 'var(--fg-tertiary)', cursor: 'grab', userSelect: 'none' }}>⠿</span>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </UICard>
      )}

      <Modal
        open={showCardModal}
        onClose={() => setShowCardModal(false)}
        title={editCard ? 'Edit Card Brand' : 'Add Card Brand'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowCardModal(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSaveCard} loading={saving}>Save</Button>
          </>
        }
      >
        <FieldShell label="Card name">
          <Input value={cardName} onChange={(e) => setCardName(e.target.value)} />
        </FieldShell>

        <FieldShell label="Logo">
          <div
            style={{ width: 100, height: 100, border: '2px dashed var(--border-default)', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 6 }}
            onClick={() => fileInputRef.current?.click()}
          >
            {logoPreview ? (
              <img src={logoPreview} alt="Logo preview" style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 6 }} />
            ) : (
              <>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="var(--fg-tertiary)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1={12} y1={3} x2={12} y2={15} />
                </svg>
                <span style={{ fontSize: 11, color: 'var(--fg-tertiary)' }}>{uploading ? 'Uploading...' : 'Upload Logo'}</span>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
        </FieldShell>

        <FieldShell label="Active">
          <Toggle checked={cardActive} onChange={setCardActive} />
        </FieldShell>

        {cardError && <p style={{ fontSize: 12, color: 'var(--tone-danger-fg)', margin: '8px 0 0' }}>{cardError}</p>}
      </Modal>

      <SidePanel
        open={!!countriesCard}
        onClose={() => setCountriesCard(null)}
        title={countriesCard ? `${countriesCard.name} — Countries` : 'Countries'}
      >
        {countriesCard && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
              {countriesCard.countries.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>No countries added yet.</p>
              )}
              {countriesCard.countries.map((country) => (
                <div key={country.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>{codeToFlag(country.country_code)}  {country.country_name}</span>
                    <span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}> ({country.currency_symbol})</span>
                  </div>
                  <Toggle checked={country.is_active} onChange={() => handleToggleCountry(country)} />
                  <Button variant="dangerSubtle" size="sm" onClick={() => handleRemoveCountry(country)}>Remove</Button>
                </div>
              ))}
            </div>

            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.11em', textTransform: 'uppercase', color: 'var(--fg-tertiary)', margin: '16px 0 10px' }}>+ Add Country</div>

            <FieldShell label="Country">
              <div ref={countryBoxRef} style={{ position: 'relative' }}>
                <Input
                  placeholder="Search country"
                  value={countryOpen ? countryQuery : (newCountryCode ? `${codeToFlag(newCountryCode)}  ${ISO_COUNTRIES.find((c) => c.code === newCountryCode)?.name || ''}` : '')}
                  onFocus={() => { setCountryOpen(true); setCountryQuery(''); }}
                  onChange={(e) => { setCountryQuery(e.target.value); setCountryOpen(true); }}
                />
                {countryOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, maxHeight: 240, overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                    {filteredCountries.map((c) => (
                      <div
                        key={c.code}
                        style={{ padding: '10px 12px', fontSize: 13, color: 'var(--fg-primary)', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setNewCountryCode(c.code);
                          setNewCurrencySymbol(c.symbol);
                          setNewCurrencyName(c.currency);
                          setCountryOpen(false);
                          setCountryQuery('');
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{codeToFlag(c.code)}  {c.name}</span>
                        <span style={{ color: 'var(--fg-tertiary)', fontSize: 11, marginLeft: 6 }}>{c.currency} {c.symbol}</span>
                      </div>
                    ))}
                    {filteredCountries.length === 0 && (
                      <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--fg-tertiary)' }}>No matches</div>
                    )}
                  </div>
                )}
              </div>
            </FieldShell>

            <FieldShell label="Currency symbol">
              <Input maxLength={5} placeholder="e.g. $" value={newCurrencySymbol} onChange={(e) => setNewCurrencySymbol(e.target.value)} />
            </FieldShell>

            <FieldShell label="Currency name">
              <Input placeholder="e.g. USD" value={newCurrencyName} onChange={(e) => setNewCurrencyName(e.target.value)} />
            </FieldShell>

            <FieldShell label="Active">
              <Toggle checked={newCountryActive} onChange={setNewCountryActive} />
            </FieldShell>

            <Button
              variant="primary"
              size="sm"
              style={{ width: '100%', marginTop: 8 }}
              onClick={handleAddCountry}
              loading={addingCountry}
              disabled={!newCountryCode || !newCurrencySymbol || !newCurrencyName || addingCountry}
            >
              Add Country
            </Button>
          </>
        )}
      </SidePanel>
    </div>
  );
}
