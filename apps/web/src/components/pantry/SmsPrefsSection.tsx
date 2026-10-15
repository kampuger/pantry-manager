'use client';

import { useEffect, useState } from 'react';
import {
  confirmPhoneVerification,
  getHouseholdSmsEnabled,
  getMemberSmsEnabled,
  getMyPhoneNumber,
  getSmsAvailable,
  removeMyPhoneNumber,
  requestPhoneVerification,
  setHouseholdSmsEnabled,
  setMemberSmsEnabled,
} from '@pantry/supabase-client';
import { normalizePhPhoneNumber } from '@pantry/core';
import { useAuth } from '@/lib/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { color, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

function maskPhone(phoneE164: string): string {
  return `${phoneE164.slice(0, 3)}••••••${phoneE164.slice(-4)}`;
}

export function SmsPrefsSection({
  householdId,
  isAdmin,
  notificationsEnabled,
}: {
  householdId: string;
  isAdmin: boolean;
  notificationsEnabled: boolean;
}) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [smsAvailable, setSmsAvailable] = useState(true);
  const [householdSms, setHouseholdSms] = useState(false);
  const [memberSms, setMemberSms] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState<'enter' | 'code'>('enter');
  const [phoneInput, setPhoneInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      getSmsAvailable(supabase),
      getHouseholdSmsEnabled(supabase, householdId),
      getMemberSmsEnabled(supabase, householdId, session.user.id),
      getMyPhoneNumber(supabase, session.user.id),
    ])
      .then(([available, householdEnabled, memberEnabled, number]) => {
        setSmsAvailable(available);
        setHouseholdSms(householdEnabled);
        setMemberSms(memberEnabled);
        setPhone(number?.phoneE164 ?? null);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load SMS settings'))
      .finally(() => setLoading(false));
  }, [householdId, session]);

  function resetEditing() {
    setEditing(false);
    setStage('enter');
    setPhoneInput('');
    setCodeInput('');
  }

  async function handleHouseholdToggle(next: boolean) {
    setHouseholdSms(next);
    setError(null);
    try {
      await setHouseholdSmsEnabled(supabase, householdId, next);
    } catch (err) {
      setHouseholdSms(!next);
      setError(err instanceof Error ? err.message : 'Failed to update the household SMS setting');
    }
  }

  async function handleMemberToggle(next: boolean) {
    if (!session) return;
    setMemberSms(next);
    setError(null);
    try {
      await setMemberSmsEnabled(supabase, householdId, session.user.id, next);
    } catch (err) {
      setMemberSms(!next);
      setError(err instanceof Error ? err.message : 'Failed to update your SMS setting');
    }
  }

  async function handleSendCode() {
    const normalized = normalizePhPhoneNumber(phoneInput);
    if (!normalized) {
      setError('Enter a Philippine mobile number, like 0917 123 4567. International numbers are not supported.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestPhoneVerification(supabase, normalized);
      setPhoneInput(normalized);
      setStage('code');
      setNotice(`We texted a 6-digit code to ${normalized}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!session) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await confirmPhoneVerification(supabase, codeInput.trim());
      setPhone(result.phoneE164);
      // They just proved the number to get texts, so turn the digest on for them.
      await setMemberSmsEnabled(supabase, householdId, session.user.id, true);
      setMemberSms(true);
      resetEditing();
      setNotice(
        notificationsEnabled
          ? 'Number verified. You will get the daily digest by SMS.'
          : 'Number verified. Turn on "Notify me about expiring items" above to start receiving texts.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the code');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!session) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Switch the toggle off first: if deleting the number then fails, the UI
      // still matches the server (toggle off, number still on file).
      await setMemberSmsEnabled(supabase, householdId, session.user.id, false);
      setMemberSms(false);
      await removeMyPhoneNumber(supabase, session.user.id);
      setPhone(null);
      resetEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove your number');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;
  if (loadError) {
    return (
      <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>
        Couldn&apos;t load SMS settings: {loadError}
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10, borderTop: `1px solid ${color.border}`, paddingTop: 14 }}>
      <strong style={{ fontSize: 13 }}>Text message (SMS) reminders</strong>

      {isAdmin && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={householdSms} onChange={(e) => handleHouseholdToggle(e.target.checked)} />
          Allow SMS reminders for this household
        </label>
      )}

      {!householdSms && !isAdmin && (
        <p style={{ color: color.mutedForeground, fontSize: 12, margin: 0 }}>
          SMS reminders are not turned on for this household. Ask an owner or admin to enable them.
        </p>
      )}

      {!smsAvailable && (
        <p style={{ color: color.mutedForeground, fontSize: 12, margin: 0 }}>
          SMS reminders are switched off app-wide for now. They will start working once an administrator turns them on.
        </p>
      )}

      {smsAvailable && householdSms && (
        <>
          {phone && !editing && (
            <>
              <p style={{ fontSize: 13, margin: 0 }}>
                Verified number: <strong>{maskPhone(phone)}</strong>
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={memberSms} onChange={(e) => handleMemberToggle(e.target.checked)} />
                Text me the daily digest
              </label>
              {memberSms && !notificationsEnabled && (
                <p style={{ color: color.mutedForeground, fontSize: 12, margin: 0 }}>
                  Texts only go out while &quot;Notify me about expiring items&quot; above is on.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setEditing(true)} style={buttonStyle('ghost')}>
                  Change number
                </button>
                <button type="button" onClick={handleRemove} disabled={busy} style={buttonStyle('ghost')}>
                  Remove
                </button>
              </div>
            </>
          )}

          {(!phone || editing) && stage === 'enter' && (
            <>
              <label style={labelStyle}>
                Philippine mobile number
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="0917 123 4567"
                  style={inputStyle}
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={handleSendCode} disabled={busy || !phoneInput.trim()} style={buttonStyle('secondary')}>
                  {busy ? 'Sending…' : 'Send code'}
                </button>
                {editing && (
                  <button type="button" onClick={resetEditing} style={buttonStyle('ghost')}>
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}

          {(!phone || editing) && stage === 'code' && (
            <>
              <label style={labelStyle}>
                6-digit code
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  style={inputStyle}
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={handleVerify} disabled={busy || codeInput.length !== 6} style={buttonStyle('primary')}>
                  {busy ? 'Checking…' : 'Verify'}
                </button>
                <button type="button" onClick={() => setStage('enter')} style={buttonStyle('ghost')}>
                  Use a different number
                </button>
              </div>
            </>
          )}
        </>
      )}

      {notice && <p style={{ color: color.mutedForeground, fontSize: 12, margin: 0 }}>{notice}</p>}
      {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
    </div>
  );
}
