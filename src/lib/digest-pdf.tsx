import "server-only";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

/**
 * Nightly Overview PDF (Automation Push, section 7). Built with
 * @react-pdf/renderer — Vercel-serverless-safe (pure JS, no chromium) and
 * auto-paginates variable-length content. Uses the built-in Times-Roman
 * (serif headers) + Courier (mono numbers) + Helvetica (body) fonts so there
 * are no runtime font fetches. Light, print-friendly palette with the app's
 * gold accent.
 */

export interface DigestDealSection {
  address: string;
  stageLabel: string;
  inEscrowDays: number | null;
  emdLine: string;
  appraisal: string;
  waitingOn: string[];
  autoApplied: string[];
  pending: string[];
}

export interface DigestData {
  dateLabel: string;
  weekday: string;
  exposureHardNow: number;
  goingHardCount: number;
  goingHardSum: number;
  goingHardSoonest: string | null;
  /** Addresses (with amount + date) composing each exposure bucket. */
  hardNowDeals: string[];
  goingHardDeals: string[];
  deals: DigestDealSection[];
  awaitingReviewCount: number;
  quiet: boolean;
  appUrl: string;
  weekInReview?: { completed: string[]; stillPending: string[] };
  weekAhead?: string[];
}

const COLORS = {
  ink: "#14161f",
  sub: "#5b6070",
  faint: "#8b8f9c",
  gold: "#B08D3C",
  rule: "#e2e3e8",
  panel: "#f6f6f4",
  red: "#b4472b",
};

const money = (n: number): string => {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

const s = StyleSheet.create({
  page: { paddingVertical: 42, paddingHorizontal: 46, fontFamily: "Helvetica", color: COLORS.ink, fontSize: 10 },
  title: { fontFamily: "Times-Roman", fontSize: 24, color: COLORS.ink },
  subtitle: { fontFamily: "Helvetica", fontSize: 10, color: COLORS.sub, marginTop: 3 },
  goldRule: { borderBottomWidth: 2, borderBottomColor: COLORS.gold, marginTop: 10, marginBottom: 16 },
  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    letterSpacing: 1.4,
    color: COLORS.gold,
    marginTop: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  exposureRow: { flexDirection: "row", gap: 28, marginBottom: 4 },
  expBox: { flexDirection: "column" },
  expLabel: { fontFamily: "Helvetica", fontSize: 8, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.6 },
  expNum: { fontFamily: "Courier-Bold", fontSize: 18, color: COLORS.ink, marginTop: 2 },
  expNote: { fontFamily: "Helvetica", fontSize: 9, color: COLORS.sub, marginTop: 2 },
  expList: { fontFamily: "Helvetica", fontSize: 7.5, color: COLORS.faint, marginTop: 2, lineHeight: 1.35 },
  dealCard: { borderWidth: 1, borderColor: COLORS.rule, borderRadius: 6, padding: 12, marginBottom: 10 },
  dealHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  dealAddr: { fontFamily: "Times-Roman", fontSize: 13, color: COLORS.ink, flex: 1, paddingRight: 8 },
  dealStage: { fontFamily: "Helvetica", fontSize: 8, color: COLORS.faint, textAlign: "right" },
  statLine: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginBottom: 4 },
  statLabel: { fontFamily: "Helvetica", fontSize: 8, color: COLORS.faint },
  statVal: { fontFamily: "Courier", fontSize: 9, color: COLORS.ink },
  subhead: { fontFamily: "Helvetica-Bold", fontSize: 8, color: COLORS.sub, marginTop: 6, marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  bullet: { fontFamily: "Helvetica", fontSize: 9, color: COLORS.ink, marginBottom: 1.5, lineHeight: 1.3 },
  bulletRed: { fontFamily: "Helvetica", fontSize: 9, color: COLORS.red, marginBottom: 1.5, lineHeight: 1.3 },
  quietBanner: { fontFamily: "Times-Roman", fontSize: 12, color: COLORS.sub, marginTop: 12, marginBottom: 2 },
  footer: { marginTop: 18, borderTopWidth: 1, borderTopColor: COLORS.rule, paddingTop: 10 },
  footerText: { fontFamily: "Helvetica", fontSize: 9, color: COLORS.sub },
  footerLink: { fontFamily: "Helvetica", fontSize: 9, color: COLORS.gold },
});

function Bullets({ items, red }: { items: string[]; red?: boolean }) {
  return (
    <>
      {items.map((t, i) => (
        <Text key={i} style={red ? s.bulletRed : s.bullet}>
          • {t}
        </Text>
      ))}
    </>
  );
}

function DealCard({ d }: { d: DigestDealSection }) {
  return (
    <View style={s.dealCard} wrap={false}>
      <View style={s.dealHead}>
        <Text style={s.dealAddr}>{d.address}</Text>
        <Text style={s.dealStage}>
          {d.stageLabel}
          {d.inEscrowDays != null ? ` · in escrow ${d.inEscrowDays}d` : ""}
        </Text>
      </View>
      <View style={s.statLine}>
        <Text style={s.statLabel}>
          EMD <Text style={s.statVal}>{d.emdLine}</Text>
        </Text>
        <Text style={s.statLabel}>
          Appraisal <Text style={s.statVal}>{d.appraisal}</Text>
        </Text>
      </View>
      {d.waitingOn.length > 0 && (
        <>
          <Text style={s.subhead}>Waiting on</Text>
          <Bullets items={d.waitingOn} red />
        </>
      )}
      {d.autoApplied.length > 0 && (
        <>
          <Text style={s.subhead}>Auto-applied since last digest</Text>
          <Bullets items={d.autoApplied} />
        </>
      )}
      {d.pending.length > 0 && (
        <>
          <Text style={s.subhead}>Needs a tap</Text>
          <Bullets items={d.pending} />
        </>
      )}
    </View>
  );
}

function DigestDocument({ data }: { data: DigestData }) {
  const soonest = data.goingHardSoonest;
  return (
    <Document title={`Nightly Overview — ${data.dateLabel}`}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>Nightly Overview</Text>
        <Text style={s.subtitle}>
          {data.weekday}, {data.dateLabel}
        </Text>
        <View style={s.goldRule} />

        <Text style={s.sectionLabel}>EMD Exposure</Text>
        <View style={s.exposureRow}>
          <View style={s.expBox}>
            <Text style={s.expLabel}>Hard now</Text>
            <Text style={s.expNum}>{money(data.exposureHardNow)}</Text>
            {data.hardNowDeals.map((t, i) => (
              <Text key={i} style={s.expList}>
                {t}
              </Text>
            ))}
          </View>
          <View style={s.expBox}>
            <Text style={s.expLabel}>Going hard ≤10d</Text>
            <Text style={s.expNum}>{money(data.goingHardSum)}</Text>
            <Text style={s.expNote}>
              {data.goingHardCount} deal{data.goingHardCount === 1 ? "" : "s"}
              {soonest ? ` · soonest: ${soonest}` : ""}
            </Text>
            {data.goingHardDeals.map((t, i) => (
              <Text key={i} style={s.expList}>
                {t}
              </Text>
            ))}
          </View>
        </View>

        {data.quiet && <Text style={s.quietBanner}>All quiet — no changes today.</Text>}

        {/* Roster renders EVERY night; quiet only suppresses the per-deal activity subsections. */}
        <Text style={s.sectionLabel}>Escrow Deals · {data.deals.length}</Text>
        {data.deals.length ? (
          data.deals.map((d, i) => <DealCard key={i} d={d} />)
        ) : (
          <Text style={s.bullet}>• No escrow deals.</Text>
        )}

        {data.weekInReview && (
          <>
            <Text style={s.sectionLabel}>Week in Review</Text>
            <Text style={s.subhead}>Completed this week</Text>
            {data.weekInReview.completed.length ? (
              <Bullets items={data.weekInReview.completed} />
            ) : (
              <Text style={s.bullet}>• Nothing completed this week.</Text>
            )}
            <Text style={s.subhead}>Still pending</Text>
            {data.weekInReview.stillPending.length ? (
              <Bullets items={data.weekInReview.stillPending} />
            ) : (
              <Text style={s.bullet}>• Nothing outstanding.</Text>
            )}
          </>
        )}

        {data.weekAhead && (
          <>
            <Text style={s.sectionLabel}>Week Ahead</Text>
            {data.weekAhead.length ? (
              <Bullets items={data.weekAhead} />
            ) : (
              <Text style={s.bullet}>• No EMD dates, milestones, or deadlines in the next 7 days.</Text>
            )}
          </>
        )}

        <View style={s.footer}>
          <Text style={s.footerText}>
            {data.awaitingReviewCount} item{data.awaitingReviewCount === 1 ? "" : "s"} awaiting review.
          </Text>
          <Text style={s.footerLink}>{data.appUrl}/dashboard/pipeline</Text>
        </View>
      </Page>
    </Document>
  );
}

/** Render the nightly overview to a PDF Buffer for emailing as an attachment. */
export async function renderDigestPdf(data: DigestData): Promise<Buffer> {
  return renderToBuffer(<DigestDocument data={data} />);
}
