// apps/web/src/app/admin/users/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  grantAdmin,
  revokeAdmin,
  type AdminUserRow,
} from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useIsMobile } from '@/lib/useIsMobile';
import { color, cardStyle, inputStyle, buttonStyle, badgeStyle, labelStyle } from '@/lib/theme';

function isSuspended(user: AdminUserRow): boolean {
  return !!user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now();
}

function formatJoined(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminUsersPage() {
  const { session, loading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteIsError, setInviteIsError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  async function refreshUsers() {
    try {
      setUsers(await listAllUsers(supabase));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load users');
    }
  }

  useEffect(() => {
    if (!session) {
      setCheckingAccess(false);
      return;
    }
    checkIsPlatformAdmin(supabase)
      .then((ok) => {
        setIsAdmin(ok);
        if (ok) refreshUsers();
      })
      .finally(() => setCheckingAccess(false));
  }, [session]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteStatus(null);
    setInviteIsError(false);
    try {
      await inviteUser(supabase, email.trim());
      setInviteStatus(`Invite sent to ${email.trim()}`);
      setEmail('');
      await refreshUsers();
    } catch (err) {
      setInviteIsError(true);
      setInviteStatus(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  }

  async function handleToggleSuspend(user: AdminUserRow) {
    setBusyUserId(user.id);
    setActionError(null);
    try {
      if (isSuspended(user)) await unsuspendUser(supabase, user.id);
      else await suspendUser(supabase, user.id);
      await refreshUsers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleToggleAdmin(user: AdminUserRow) {
    if (!session) return;
    setBusyUserId(user.id);
    setActionError(null);
    try {
      if (user.isAdmin) await revokeAdmin(supabase, user.id);
      else await grantAdmin(supabase, user.id, session.user.id);
      await refreshUsers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyUserId(null);
    }
  }

  if (authLoading || checkingAccess) return null;

  if (!session) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Admin</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>
          <a href="/login" style={{ color: color.primary, fontWeight: 600 }}>
            Sign in
          </a>{' '}
          to continue.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Admin</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>You don&apos;t have access to this page.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <header>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Manage users</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>
          Invite new users, suspend accounts, and grant or remove admin access.
        </p>
      </header>

      <form
        onSubmit={handleInvite}
        style={{ ...cardStyle, padding: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label style={{ ...labelStyle, flex: '1 1 240px' }}>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={inviting} style={buttonStyle('primary')}>
          {inviting ? 'Sending…' : 'Send invite'}
        </button>
        {inviteStatus && (
          <p style={{ width: '100%', margin: 0, fontSize: 13, color: inviteIsError ? color.destructive : color.success }}>
            {inviteStatus}
          </p>
        )}
      </form>

      {loadError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{loadError}</p>}
      {actionError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{actionError}</p>}

      {isMobile ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {users.map((user) => {
            const suspended = isSuspended(user);
            const isSelf = user.id === session.user.id;
            return (
              <div key={user.id} style={{ ...cardStyle, padding: 16, display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-all' }}>{user.email ?? '(no email)'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={badgeStyle(suspended ? 'destructive' : 'success')}>{suspended ? 'Suspended' : 'Active'}</span>
                  {user.isAdmin && <span style={badgeStyle('muted')}>Admin</span>}
                </div>
                <div style={{ fontSize: 12, color: color.mutedForeground }}>Joined {formatJoined(user.createdAt)}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => handleToggleSuspend(user)} disabled={busyUserId === user.id} style={buttonStyle('secondary')}>
                    {suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button
                    onClick={() => handleToggleAdmin(user)}
                    disabled={busyUserId === user.id || isSelf}
                    title={isSelf ? "You can't remove your own admin access from here" : undefined}
                    style={buttonStyle('secondary')}
                  >
                    {user.isAdmin ? 'Remove admin' : 'Make admin'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...cardStyle, padding: 20, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${color.border}`, textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Email</th>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Admin</th>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Joined</th>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }} />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const suspended = isSuspended(user);
                const isSelf = user.id === session.user.id;
                return (
                  <tr key={user.id} style={{ borderBottom: `1px solid ${color.border}` }}>
                    <td style={{ padding: '10px', wordBreak: 'break-all' }}>{user.email ?? '(no email)'}</td>
                    <td style={{ padding: '10px' }}>
                      <span style={badgeStyle(suspended ? 'destructive' : 'success')}>{suspended ? 'Suspended' : 'Active'}</span>
                    </td>
                    <td style={{ padding: '10px' }}>{user.isAdmin && <span style={badgeStyle('muted')}>Admin</span>}</td>
                    <td style={{ padding: '10px', color: color.mutedForeground }}>{formatJoined(user.createdAt)}</td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => handleToggleSuspend(user)} disabled={busyUserId === user.id} style={buttonStyle('secondary')}>
                          {suspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                        <button
                          onClick={() => handleToggleAdmin(user)}
                          disabled={busyUserId === user.id || isSelf}
                          title={isSelf ? "You can't remove your own admin access from here" : undefined}
                          style={buttonStyle('secondary')}
                        >
                          {user.isAdmin ? 'Remove admin' : 'Make admin'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
