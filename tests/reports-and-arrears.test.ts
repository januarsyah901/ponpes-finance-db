import { describe, it, expect } from 'vitest';
import { formatPhoneNumberForWa, buildWaReminderMessage } from '../src/services/arrears';

describe('Milestone 4 Services - Arrears & WhatsApp Reminders', () => {
  it('correctly normalizes Indonesian phone numbers for wa.me format', () => {
    expect(formatPhoneNumberForWa('081234567890')).toBe('6281234567890');
    expect(formatPhoneNumberForWa('+6281234567890')).toBe('6281234567890');
    expect(formatPhoneNumberForWa('0812-3456-7890')).toBe('6281234567890');
    expect(formatPhoneNumberForWa('6281234567890')).toBe('6281234567890');
  });

  it('generates polite, professional WhatsApp reminder messages with formatted currency', () => {
    const message = buildWaReminderMessage({
      nama: 'Ahmad Fauzi',
      nis: '2024001',
      komplekNama: 'Komplek Al-Falah (Putra 1)',
      totalTunggakan: 900000,
      daftarTagihan: [
        { bulan: 9, tahun: 2026, sisa: 450000 },
        { bulan: 10, tahun: 2026, sisa: 450000 },
      ],
    });

    expect(message).toContain('Ahmad Fauzi');
    expect(message).toContain('2024001');
    expect(message).toContain('Komplek Al-Falah (Putra 1)');
    expect(message).toContain('Rp 900.000');
    expect(message).toContain('September 2026');
    expect(message).toContain('Oktober 2026');
    expect(message).toContain('Assalamu\'alaikum');
  });
});
