export type Party = 'D' | 'R' | 'I' | 'L' | 'G' | 'O'
export type Candidate = { id: string; name: string; party: Party }
export type Kind = 'senate' | 'house' | 'governor' | 'congress' | 'senate_seats' | 'house_seats'
export type Phase = 'proposed' | 'rejected' | 'open' | 'closed' | 'settled' | 'canceled'
export type Basis = 'single_round' | 'runoff_final' | 'rcv_final'

export type Market = {
  id: string
  kind: Kind
  title: string
  jurisdiction: string
  status: string
  phase: Phase
  candidates: Candidate[]
  has_other: boolean
  outcome_basis: Basis
  rules_note: string
  buy_in_cents: number | null
  entry_deadline: string | null
  polling_ref: { race_type: 'senate' | 'house' | 'governor'; state: string; district: string | null; special: boolean } | null
  featured: boolean
  sort_order: number
  entrants: number
  pool_cents: number
  has_entry: boolean
  proposed_by_me: boolean
  proposed_by_name: string | null
  cancel_reason: string | null
  result_winner_id?: string | null
  result_winner_share_tenths?: number | null
  result_seats?: Seats | { r: number } | null
  result_source_url?: string | null
}

export type Chamber = { d: number; r: number; o: number }
export type Seats = { house: Chamber; senate: Chamber }
export type Shares = Record<string, number> // tenths of a percentage point; includes "other" when the market has it

export type Entry = {
  id: string
  user_id: string
  display_name?: string
  winner_id: string | null
  shares: Shares | null
  seats: Seats | { r: number } | null
  commitment_cents: number
}

export type Payout = {
  entry_id: string
  user_id: string
  eligible: boolean
  error_value: number | null
  gross_cents: number
  refund_cents: number
  commitment_cents: number
}

export type PollSnapshot = {
  id: string
  source_kind: 'provider' | 'manual' | 'fixture'
  source_name: string
  source_url: string | null
  as_of: string
  fetched_at: string
  data: { candidates: { name: string; party?: string; pct: number }[]; undecided?: number | null; other?: number | null; note?: string }
}

export type Run = {
  version: number
  outcome: 'settled' | 'no_winner_refund' | 'underfilled_refund' | 'canceled_refund'
  reason: string | null
  result: { winner_id?: string; winner_share_tenths?: number; seats?: Seats | { r: number }; source_url?: string }
  pool_cents: number
  created_at: string
}

export type MarketDetail = {
  market: Market
  my_entry: Entry | null
  entries: Entry[] | null
  polling: { latest: PollSnapshot | null; at_close: PollSnapshot | null }
  runs: Run[]
  payouts: Payout[]
}

export type Me = {
  user_id: string | null
  is_member: boolean
  is_admin: boolean
  display_name: string | null
  has_phone: boolean
  open_signup: boolean
  group: { name: string; default_buy_in_cents: number; default_deadline: string; admin_name: string | null } | null
}
