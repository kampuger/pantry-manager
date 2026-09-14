import { View, Text, StyleSheet } from 'react-native';
import { getExpiryBadgeStatus, type ExpiryBadgeStatus } from '@pantry/ui';
import type { Database } from '@pantry/supabase-client';
import { Badge } from '../Badge';
import { AppButton } from '../AppButton';
import { color, cardStyle, font } from '../../lib/theme';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

const EXPIRY_TONE: Record<ExpiryBadgeStatus, 'destructive' | 'warning' | 'success' | 'muted'> = {
  critical: 'destructive',
  warning: 'warning',
  ok: 'success',
  unknown: 'muted',
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function PantryLocationGroup({
  icon,
  label,
  expiringSoonCount,
  items,
  onEdit,
  onConsumed,
  onExpired,
}: {
  icon: string;
  label: string;
  expiringSoonCount: number;
  items: PantryItemRow[];
  onEdit: (item: PantryItemRow) => void;
  onConsumed: (item: PantryItemRow) => void;
  onExpired: (item: PantryItemRow) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={styles.sectionTitle}>{label}</Text>
        <Text style={styles.summary}>
          {items.length} item{items.length === 1 ? '' : 's'}
          {expiringSoonCount > 0 ? `, ${expiringSoonCount} expiring soon` : ''}
        </Text>
      </View>
      {items.map((item) => {
        const status = getExpiryBadgeStatus(daysUntil(item.expiration_date));
        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.itemHeaderRow}>
              <Text style={styles.name}>
                {item.is_produce ? '🥬 ' : ''}
                {item.name}
              </Text>
              <Badge tone={EXPIRY_TONE[status]}>{status}</Badge>
            </View>
            <Text style={styles.meta}>
              {item.quantity} {item.unit}
              {item.expiration_date && ` · Expires ${item.expiration_date}`}
            </Text>
            <View style={styles.actionsRow}>
              <AppButton title="Edit" variant="secondary" onPress={() => onEdit(item)} />
              <AppButton title="Consumed" variant="secondary" onPress={() => onConsumed(item)} />
              <AppButton title="Expired/Discard" variant="danger" onPress={() => onExpired(item)} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  icon: { fontSize: 16 },
  sectionTitle: { fontSize: 15, fontFamily: font.semibold, color: color.foreground },
  summary: { fontSize: 12, color: color.mutedForeground, fontFamily: font.regular },
  itemCard: { ...cardStyle, padding: 16, gap: 6 },
  itemHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontFamily: font.semibold, color: color.foreground },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
});
