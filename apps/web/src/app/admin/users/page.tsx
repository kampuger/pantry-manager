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
  deleteUser,
  listPendingApplications,
  markApplicationApproved,
  markApplicationRejected,
  type AdminUserRow,
  type AccessApplication,
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
  const [applications, setApplications] = useState<AccessApplication[]>([]);
  const [applicationsError, setApplicationsError] = useState<string | null>(null);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<Set<string>>(new Set());
  const [applicationsBusy, setApplicationsBusy] = useState(false);
  const [applicationRowErrors, setApplicationRowErrors] = useState<Record<string, string>>({});
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [userRowErrors, setUserRowErrors] = useState<Record<string, string>>({});
  const [bulkUserBusy, setBulkUserBusy] = useState(false);

  async function refreshUsers() {
    try {
      setUsers(await listAllUsers(supabase));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load users');
    }
  }

  async function refreshApplications() {
    try {
      setApplications(await listPendingApplications(supabase));
    } catch (err) {
      setApplicationsError(err instanceof Error ? err.message : 'Failed to load applications');
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
        if (ok) {
          refreshUsers();
          refreshApplications();
        }
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

  function toggleApplicationSelected(id: string) {
    setSelectedApplicationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllApplications() {
    setSelectedApplicationIds((prev) =>
      prev.size === applications.length ? new Set() : new Set(applications.map((a) => a.id))
    );
  }

  async function runApplicationAction(
    ids: string[],
    action: (application: AccessApplication) => Promise<void>
  ) {
    setApplicationsBusy(true);
    const errors: Record<string, string> = {};
    for (const id of ids) {
      const application = applications.find((a) => a.id === id);
      if (!application) continue;
      try {
        await action(application);
      } catch (err) {
        errors[id] = err instanceof Error ? err.message : 'Action failed';
      }
    }
    setApplicationRowErrors(errors);
    setSelectedApplicationIds(new Set());
    await refreshApplications();
    setApplicationsBusy(false);
  }

  async function handleApprove(ids: string[]) {
    if (!session) return;
    await runApplicationAction(ids, async (application) => {
      await inviteUser(supabase, application.email);
      await markApplicationApproved(supabase, application.id, session.user.id);
    });
  }

  async function handleReject(ids: string[]) {
    if (!session) return;
    await runApplicationAction(ids, async (application) => {
      await markApplicationRejected(supabase, application.id, session.user.id);
    });
  }

  const selectableUserIds = session ? users.filter((u) => u.id !== session.user.id).map((u) => u.id) : [];
  const allSelectableUsersSelected =
    selectableUserIds.length > 0 && selectableUserIds.every((id) => selectedUserIds.has(id));

  function toggleUserSelected(id: string) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllUsers() {
    setSelectedUserIds((prev) =>
      selectableUserIds.length > 0 && selectableUserIds.every((id) => prev.has(id)) ? new Set() : new Set(selectableUserIds)
    );
  }

  async function runUserAction(ids: string[], action: (userId: string) => Promise<void>) {
    setBulkUserBusy(true);
    const errors: Record<string, string> = {};
    for (const id of ids) {
      try {
        await action(id);
      } catch (err) {
        errors[id] = err instanceof Error ? err.message : 'Action failed';
      }
    }
    setUserRowErrors(errors);
    setSelectedUserIds(new Set());
    await refreshUsers();
    setBulkUserBusy(false);
  }

  async function handleBulkSuspend() {
    await runUserAction([...selectedUserIds], (id) => suspendUser(supabase, id));
  }

  async function handleBulkUnsuspend() {
    await runUserAction([...selectedUserIds], (id) => unsuspendUser(supabase, id));
  }

  async function handleBulkDelete() {
    const ids = [...selectedUserIds];
    const n = ids.length;
    if (!window.confirm(`Delete ${n} user${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
    await runUserAction(ids, (id) => deleteUser(supabase, id));
  }

  async function handleDeleteSingle(user: AdminUserRow) {
    if (!window.confirm(`Delete ${user.email ?? 'this user'}? This cannot be undone.`)) return;
    await runUserAction([user.id], (id) => deleteUser(supabase, id));
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

      <section style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 18, margin: 0, letterSpacing: '-0.01em' }}>Pending applications</h2>
          {selectedApplicationIds.size > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleApprove([...selectedApplicationIds])}
                disabled={applicationsBusy}
                style={buttonStyle('primary')}
              >
                Approve {selectedApplicationIds.size} selected
              </button>
              <button
                onClick={() => handleReject([...selectedApplicationIds])}
                disabled={applicationsBusy}
                style={buttonStyle('secondary')}
              >
                Reject {selectedApplicationIds.size} selected
              </button>
            </div>
          )}
        </div>

        {applicationsError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{applicationsError}</p>}

        {applications.length === 0 ? (
          <p style={{ ...cardStyle, padding: 16, margin: 0, color: color.mutedForeground, fontSize: 14 }}>
            No pending applications.
          </p>
        ) : isMobile ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {applications.map((application) => (
              <div key={application.id} style={{ ...cardStyle, padding: 16, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={selectedApplicationIds.has(application.id)}
                    onChange={() => toggleApplicationSelected(application.id)}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-all' }}>{application.email}</div>
                    {application.message && (
                      <div style={{ fontSize: 13, color: color.mutedForeground }}>{application.message}</div>
                    )}
                    <div style={{ fontSize: 12, color: color.mutedForeground }}>
                      Applied {formatJoined(application.submittedAt)}
                    </div>
                  </div>
                </div>
                {applicationRowErrors[application.id] && (
                  <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{applicationRowErrors[application.id]}</p>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => handleApprove([application.id])} disabled={applicationsBusy} style={buttonStyle('primary')}>
                    Approve
                  </button>
                  <button onClick={() => handleReject([application.id])} disabled={applicationsBusy} style={buttonStyle('secondary')}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...cardStyle, padding: 20, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${color.border}`, textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', width: 32 }}>
                    <input
                      type="checkbox"
                      checked={applications.length > 0 && selectedApplicationIds.size === applications.length}
                      onChange={toggleSelectAllApplications}
                    />
                  </th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Message</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Applied</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }} />
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id} style={{ borderBottom: `1px solid ${color.border}` }}>
                    <td style={{ padding: '10px' }}>
                      <input
                        type="checkbox"
                        checked={selectedApplicationIds.has(application.id)}
                        onChange={() => toggleApplicationSelected(application.id)}
                      />
                    </td>
                    <td style={{ padding: '10px', wordBreak: 'break-all' }}>{application.email}</td>
                    <td style={{ padding: '10px', color: color.mutedForeground }}>{application.message ?? '—'}</td>
                    <td style={{ padding: '10px', color: color.mutedForeground }}>{formatJoined(application.submittedAt)}</td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => handleApprove([application.id])} disabled={applicationsBusy} style={buttonStyle('primary')}>
                            Approve
                          </button>
                          <button onClick={() => handleReject([application.id])} disabled={applicationsBusy} style={buttonStyle('secondary')}>
                            Reject
                          </button>
                        </div>
                        {applicationRowErrors[application.id] && (
                          <p style={{ color: color.destructive, fontSize: 12, margin: 0 }}>{applicationRowErrors[application.id]}</p>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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

      {selectedUserIds.size > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleBulkSuspend} disabled={bulkUserBusy} style={buttonStyle('secondary')}>
            Suspend selected ({selectedUserIds.size})
          </button>
          <button onClick={handleBulkUnsuspend} disabled={bulkUserBusy} style={buttonStyle('secondary')}>
            Unsuspend selected ({selectedUserIds.size})
          </button>
          <button onClick={handleBulkDelete} disabled={bulkUserBusy} style={buttonStyle('danger')}>
            Delete selected ({selectedUserIds.size})
          </button>
        </div>
      )}

      {isMobile ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {users.map((user) => {
            const suspended = isSuspended(user);
            const isSelf = user.id === session.user.id;
            return (
              <div key={user.id} style={{ ...cardStyle, padding: 16, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={selectedUserIds.has(user.id)}
                    disabled={isSelf}
                    title={isSelf ? "You can't select your own account" : undefined}
                    onChange={() => toggleUserSelected(user.id)}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ display: 'grid', gap: 8, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-all' }}>{user.email ?? '(no email)'}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={badgeStyle(suspended ? 'destructive' : 'success')}>{suspended ? 'Suspended' : 'Active'}</span>
                      {user.isAdmin && <span style={badgeStyle('muted')}>Admin</span>}
                    </div>
                    <div style={{ fontSize: 12, color: color.mutedForeground }}>Joined {formatJoined(user.createdAt)}</div>
                  </div>
                </div>
                {userRowErrors[user.id] && (
                  <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{userRowErrors[user.id]}</p>
                )}
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
                  <button
                    onClick={() => handleDeleteSingle(user)}
                    disabled={bulkUserBusy || isSelf}
                    title={isSelf ? "You can't delete your own account" : undefined}
                    style={buttonStyle('danger')}
                  >
                    Delete
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
                <th style={{ padding: '8px 10px', width: 32 }}>
                  <input type="checkbox" checked={allSelectableUsersSelected} onChange={toggleSelectAllUsers} />
                </th>
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
                    <td style={{ padding: '10px' }}>
                      <input
                        type="checkbox"
                        checked={selectedUserIds.has(user.id)}
                        disabled={isSelf}
                        title={isSelf ? "You can't select your own account" : undefined}
                        onChange={() => toggleUserSelected(user.id)}
                      />
                    </td>
                    <td style={{ padding: '10px', wordBreak: 'break-all' }}>{user.email ?? '(no email)'}</td>
                    <td style={{ padding: '10px' }}>
                      <span style={badgeStyle(suspended ? 'destructive' : 'success')}>{suspended ? 'Suspended' : 'Active'}</span>
                    </td>
                    <td style={{ padding: '10px' }}>{user.isAdmin && <span style={badgeStyle('muted')}>Admin</span>}</td>
                    <td style={{ padding: '10px', color: color.mutedForeground }}>{formatJoined(user.createdAt)}</td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'grid', gap: 4 }}>
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
                          <button
                            onClick={() => handleDeleteSingle(user)}
                            disabled={bulkUserBusy || isSelf}
                            title={isSelf ? "You can't delete your own account" : undefined}
                            style={buttonStyle('danger')}
                          >
                            Delete
                          </button>
                        </div>
                        {userRowErrors[user.id] && (
                          <p style={{ color: color.destructive, fontSize: 12, margin: 0 }}>{userRowErrors[user.id]}</p>
                        )}
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
