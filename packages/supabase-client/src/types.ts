// Hand-written minimal subset matching supabase/migrations/20260913000001_initial_schema.sql.
// Replace this file with `supabase gen types typescript --local` output once a live
// Supabase project/local stack exists — do not hand-maintain this long-term.
export interface Database {
  public: {
    Tables: {
      households: {
        Row: {
          id: string;
          name: string;
          weekly_shopping_day: number | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['households']['Row']> & {
          name: string;
          created_by: string;
        };
        Update: Partial<Database['public']['Tables']['households']['Row']>;
        Relationships: [];
      };
      household_members: {
        Row: {
          id: string;
          household_id: string;
          user_id: string;
          role: 'OWNER' | 'ADMIN' | 'MEMBER';
          joined_at: string;
        };
        Insert: Partial<Database['public']['Tables']['household_members']['Row']> & {
          household_id: string;
          user_id: string;
          role: 'OWNER' | 'ADMIN' | 'MEMBER';
        };
        Update: Partial<Database['public']['Tables']['household_members']['Row']>;
        Relationships: [];
      };
      pantry_items: {
        Row: {
          id: string;
          household_id: string;
          category_id: string | null;
          grocery_trip_id: string | null;
          name: string;
          quantity: number;
          unit: string;
          storage_location: string;
          purchase_date: string | null;
          expiration_date: string | null;
          purchase_price: number | null;
          replenishment_threshold: number | null;
          notify_on_low_stock: boolean;
          notify_days_before_expiry: number | null;
          is_archived: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['pantry_items']['Row']> & {
          household_id: string;
          name: string;
          unit: string;
        };
        Update: Partial<Database['public']['Tables']['pantry_items']['Row']>;
        Relationships: [];
      };
      inventory_movement_logs: {
        Row: {
          id: string;
          household_id: string;
          pantry_item_id: string;
          event_type: 'PURCHASED' | 'CONSUMED' | 'EXPIRED' | 'SPOILED_DISCARDED' | 'MANUAL_ADJUST';
          quantity_delta: number;
          value_delta: number | null;
          triggered_by: string | null;
          related_recipe_id: string | null;
          note: string | null;
          occurred_at: string;
        };
        Insert: Partial<Database['public']['Tables']['inventory_movement_logs']['Row']> & {
          household_id: string;
          pantry_item_id: string;
          event_type: 'PURCHASED' | 'CONSUMED' | 'EXPIRED' | 'SPOILED_DISCARDED' | 'MANUAL_ADJUST';
          quantity_delta: number;
        };
        Update: Partial<Database['public']['Tables']['inventory_movement_logs']['Row']>;
        Relationships: [];
      };
      grocery_list_entries: {
        Row: {
          id: string;
          household_id: string;
          name: string;
          quantity: number | null;
          unit: string | null;
          source_recipe_ingredient_id: string | null;
          is_checked: boolean;
          added_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['grocery_list_entries']['Row']> & {
          household_id: string;
          name: string;
        };
        Update: Partial<Database['public']['Tables']['grocery_list_entries']['Row']>;
        Relationships: [];
      };
    };
    // supabase-js's GenericSchema constraint requires these keys to be present
    // (even empty) for its generic table-typing to activate at all — without
    // them, every `.from(...)` call silently degenerates to `never`.
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
