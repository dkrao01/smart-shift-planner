import React from 'react';
import { Card, CardHeader } from '../components/common/Card';
import { PageHeader } from '../components/common/LoadingSpinner';
import { Badge } from '../components/common/Badge';
import { IS_DEMO_MODE } from '../lib/firebase';
import { USE_SUPABASE } from '../lib/supabase';
import { MOCK_USERS } from '../data/mockData';

const IS_LOCAL_DEMO_MODE = IS_DEMO_MODE && !USE_SUPABASE;

const RULES = [
  {
    icon: '▦',
    title: '23-Day Schedule Period',
    body: 'Schedules are planned for one complete period: Cycle 1 (6 work + 2 off), Cycle 2 (6 work + 2 off), and Cycle 3 (6 work + 1 off). Employees submit availability for all 23 days at once.',
  },
  {
    icon: '🔄',
    title: 'Three-Cycle Pattern',
    body: 'The first two cycles contain 6 working days and 2 rest days. The third contains 6 working days and 1 rest day. Together, these 3 cycles make one 23-day period.',
  },
  {
    icon: '⏱',
    title: '48-Hour Cycle Requirement',
    body: 'Every employee must complete exactly 48 working hours in each cycle and finish the period with exactly 48h of Day, 48h of Evening, and 48h of Night work. No shift type may be under or over 48h at period end. Allowed shift durations: 8h, 12h, or 16h.',
    examples: ['8h × 6 days = 48h (6 work + 2 off)', '16h × 3 days = 48h (3 work + 5 off)', '12h shifts: 4 × 12h = 48h'],
  },
  {
    icon: '✓',
    title: 'Availability Choices',
    body: 'For each date not marked as a manager-assigned rest day, every employee chooses exactly one: Day, Evening, or Night. The manager selects the 5 rest days individually. Day, Evening, and Night must each be selected exactly 6 times per period.',
  },
  {
    icon: '👥',
    title: 'Minimum 2 Employees Per Shift',
    body: 'Each of the 3 daily shifts (Day, Evening, Night) must have at least 2 employees assigned. Shifts below this show a shortage warning.',
  },
  {
    icon: '☀🌆🌙',
    title: 'Three Daily Shifts',
    body: 'Every working day has 3 shifts:',
    examples: ['Day Shift: 07:00 – 16:00', 'Evening Shift: 16:00 – 23:00', 'Night Shift: 23:00 – 07:00 (next day)'],
  },
  {
    icon: '⚖',
    title: 'Shift Type Balance',
    body: 'In every 23-day period, each employee must complete 48h of Day, 48h of Evening, and 48h of Night shifts. This balances the total time spent on each shift type and prevents repeated swaps from avoiding a shift.',
  },
  {
    icon: '⇄',
    title: 'Shift Swap Rules',
    body: 'An employee can request to swap a shift with a colleague. Swaps are NOT final until the manager approves. Before approval, the system checks:',
    examples: [
      'The replacement shift must be a different shift type on the exact same date',
      'Day can swap only with Evening; Evening can swap with Day or Night; Night can swap only with Evening',
      'Both shifts still meet minimum 2-person coverage',
      'Neither employee exceeds 48h in their cycle',
      'Both employees keep at least 8h before their next shift',
      'Fairness rotation balance is maintained',
    ],
  },
  {
    icon: '◯',
    title: 'Open Shift Pool',
    body: 'If an employee cannot attend an assigned shift, they can place it in the Open Pool. Other eligible employees may request to pick it up. Manager approval is required before the shift transfers.',
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Rules & Info" subtitle="How the scheduling system works" />

      {/* Demo mode credentials */}
      {IS_LOCAL_DEMO_MODE && (
        <Card className="border border-amber-500/25">
          <CardHeader title="Demo Mode — Login Credentials" icon="🔑" subtitle="Password for all accounts: demo123" />
          <div className="space-y-1.5">
            {MOCK_USERS.map(u => (
              <div key={u.uid} className="flex items-center justify-between py-1.5 border-b border-navy-700/50 last:border-0">
                <div>
                  <div className="text-sm text-navy-200">{u.name}</div>
                  <div className="text-xs text-navy-500 font-mono">{u.email}</div>
                </div>
                <Badge variant={u.role === 'manager' ? 'warning' : 'info'} size="xs">
                  {u.role}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Business rules */}
      <div className="space-y-3">
        {RULES.map((rule, i) => (
          <Card key={i} bordered>
            <div className="flex gap-3">
              <div className="text-xl shrink-0 mt-0.5">{rule.icon}</div>
              <div>
                <h3 className="text-sm font-semibold text-navy-100 mb-1">{rule.title}</h3>
                <p className="text-xs text-navy-400 leading-relaxed">{rule.body}</p>
                {rule.examples && (
                  <ul className="mt-2 space-y-0.5">
                    {rule.examples.map((ex, j) => (
                      <li key={j} className="text-xs text-navy-500 font-mono flex gap-2">
                        <span className="text-brand-500/60">›</span>{ex}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Tech info */}
      <Card>
        <CardHeader title="System Information" icon="ℹ" />
        <div className="space-y-2 text-xs text-navy-400">
          <div className="flex justify-between">
            <span>Mode</span>
            <span className="font-mono">{IS_LOCAL_DEMO_MODE ? 'DEMO (local data)' : USE_SUPABASE ? 'SUPABASE (live)' : 'FIREBASE (live)'}</span>
          </div>
          <div className="flex justify-between">
            <span>Version</span>
            <span className="font-mono">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span>Built with</span>
            <span className="font-mono">React + TypeScript + Tailwind</span>
          </div>
          <div className="flex justify-between">
            <span>PWA</span>
            <span className="font-mono text-emerald-400">Enabled — installable</span>
          </div>
        </div>
      </Card>

      {/* Mobile install tip */}
      <Card className="border border-sky-500/20">
        <CardHeader title="Install on Your Phone" icon="📱" />
        <div className="space-y-3 text-xs text-navy-400">
          <div>
            <div className="text-navy-300 font-medium mb-1">iPhone (Safari):</div>
            <ol className="list-decimal list-inside space-y-0.5 text-navy-500">
              <li>Open this URL in Safari</li>
              <li>Tap the Share button (box with arrow)</li>
              <li>Scroll down and tap "Add to Home Screen"</li>
              <li>Tap "Add" — icon appears on your home screen</li>
            </ol>
          </div>
          <div>
            <div className="text-navy-300 font-medium mb-1">Android (Chrome):</div>
            <ol className="list-decimal list-inside space-y-0.5 text-navy-500">
              <li>Open this URL in Chrome</li>
              <li>Tap the 3-dot menu (⋮)</li>
              <li>Tap "Add to Home screen" or "Install app"</li>
              <li>Tap "Add" — app installs on your home screen</li>
            </ol>
          </div>
          <div className="bg-navy-900 rounded p-2 text-navy-500">
            No App Store download required. Works offline after first load.
          </div>
        </div>
      </Card>
    </div>
  );
}
