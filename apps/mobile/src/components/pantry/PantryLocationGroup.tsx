import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { daysUntil, getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import { resolveNotifyThreshold, formatPHP, type HouseholdNotifyDefaults } from '@pantry/core';
import type { Database } from '@pantry/supabase-client';
import { Badge } from '../Badge';
import { AppButton } from '../AppButton';
import { color, radius, cardStyle, font, badgeColors } from '../../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const EXPIRY_TONE: Record<ExpiryBadgeStatus, 'destructive' | 'warning' | 'success' | 'muted'> = {
  expired: 'destructive',
  warning: 'warning',
  good: 'success',
  unknown: 'muted',
};

// Left accent rail per card — instant scannability without adding colors;
// every value below is an existing token from lib/theme.
const EXPIRY_ACCENT: Record<ExpiryBadgeStatus, string> = {
  expired: color.destructive,
  warning: color.warning,
  good: color.success,
  unknown: color.border,
};

export function PantryLocationGroup({
  icon,
  label,
  expiringSoonCount,
  expiredCount,
  items,
  notifyPrefs,
  onEdit,
  onConsumed,
  onExpired,
}: {
  icon: string;
  label: string;
  expiringSoonCount: number;
  expiredCount: number;
  items: PantryItemRow[];
  notifyPrefs: HouseholdNotifyDefaults;
  onEdit: (item: PantryItemRow) => void;
  onConsumed: (item: PantryItemRow) => void;
  onExpired: (item: PantryItemRow) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const warnTone = badgeColors('warning');
  const destructiveTone = badgeColors('destructive');
  const mutedTone = badgeColors('muted');

  return (
    <View style={styles.section}>
      <Pressable onPress={() => setCollapsed((v) => !v)} style={styles.headerRow}>
        <Text style={styles.chevron}>{collapsed ? '▸' : '▾'}</Text>
        <View style={styles.iconChip}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.sectionTitle}>{label}</Text>
          <Text style={styles.summary}>
            {items.length} item{items.length === 1 ? '' : 's'}
          </Text>
        </View>
        <View style={styles.pillRow}>
          {expiringSoonCount > 0 ? (
            <Text style={[styles.headerPill, { backgroundColor: warnTone.background, color: warnTone.color }]}>
              {expiringSoonCount} expiring soon
            </Text>
          ) : null}
          {expiredCount > 0 ? (
            <Text style={[styles.headerPill, { backgroundColor: destructiveTone.background, color: destructiveTone.color }]}>
              {expiredCount} expired
            </Text>
          ) : null}
        </View>
      </Pressable>
      {!collapsed &&
        items.map((item) => {
          const threshold = resolveNotifyThreshold(
            { isProduce: item.is_produce, notifyDaysBeforeExpiry: item.notify_days_before_expiry },
            notifyPrefs
          );
          const status = getExpiryBadgeStatus(daysUntil(item.expiration_date), threshold);
          return (
            <View key={item.id} style={[styles.itemCard, { borderLeftColor: EXPIRY_ACCENT[status] }]}>
              <View style={styles.itemHeaderRow}>
                <Text style={styles.name}>
                  {item.is_produce ? '🥬 ' : ''}
                  {item.name}
                </Text>
                <Badge tone={EXPIRY_TONE[status]}>{status}</Badge>
              </View>
              <View style={styles.metaRow}>
                <Text style={[styles.qtyChip, { backgroundColor: mutedTone.background, color: mutedTone.color }]}>
                  {item.quantity} {item.unit}
                </Text>
                {item.purchase_price != null ? <Text style={styles.meta}>{formatPHP(item.purchase_price)}</Text> : null}
                {item.expiration_date ? <Text style={styles.meta}>Expires {item.expiration_date}</Text> : null}
              </View>
              <View style={styles.actionsRow}>
                <AppButton title="Edit" variant="secondary" onPress={() => onEdit(item)} style={styles.actionButton} />
                <AppButton
                  title="Consumed"
                  variant="secondary"
                  onPress={() => onConsumed(item)}
                  style={styles.consumedButton}
                />
                <AppButton
                  title="Expired/Discard"
                  variant="danger"
                  onPress={() => onExpired(item)}
                  style={styles.actionButton}
                />
              </View>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  chevron: { fontSize: 11, color: color.mutedForeground, width: 12 },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: color.muted,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 17 },
  headerText: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 16, fontFamily: font.bold, color: color.foreground, letterSpacing: -0.2 },
  summary: { fontSize: 12, color: color.mutedForeground, fontFamily: font.semibold, letterSpacing: 0.2 },
  pillRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  headerPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontFamily: font.semibold,
    overflow: 'hidden',
  },
  itemCard: { ...cardStyle, paddingVertical: 14, paddingHorizontal: 16, gap: 10, borderLeftWidth: 3 },
  itemHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  name: { flex: 1, fontSize: 15, lineHeight: 21, fontFamily: font.bold, color: color.foreground },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  qtyChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontFamily: font.semibold,
    overflow: 'hidden',
  },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingTop: 10,
  },
  actionButton: { paddingVertical: 9, paddingHorizontal: 14 },
  consumedButton: { paddingVertical: 9, paddingHorizontal: 14, backgroundColor: color.successBg },
});
