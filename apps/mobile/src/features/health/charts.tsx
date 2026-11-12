import { View } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';
import { colors } from '@/theme';

const W = 324;

/**
 * Weight line (1B, 4A): one slot per day, a dark line through the days with a reading and a
 * dashed target line. Purely visual: the card's text carries the numbers for VoiceOver.
 */
export function WeightLine(props: {
  /** One entry per slot (day), null where there's no reading. */
  values: readonly (number | null)[];
  target: number | null;
  height?: number;
  accessibilityLabel: string;
  testID?: string;
}) {
  const H = props.height ?? 64;
  const present = props.values.filter((v): v is number => v != null);
  const all = props.target != null ? [...present, props.target] : present;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(0.5, max - min);
  const pad = 8;
  const y = (v: number) => pad + ((max - v) / span) * (H - pad * 2);
  const n = props.values.length;
  const x = (i: number) => (n <= 1 ? W / 2 : 6 + (i * (W - 12)) / (n - 1));
  const points = props.values
    .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
    >
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {props.target != null ? (
          <>
            <Line
              x1={0}
              y1={y(props.target)}
              x2={W}
              y2={y(props.target)}
              stroke={colors.textSecondary}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <SvgText
              x={W - 2}
              y={Math.max(11, y(props.target) - 5)}
              textAnchor="end"
              fontSize={11}
              fill={colors.textSecondary}
            >
              {`Target ${props.target.toFixed(1)}`}
            </SvgText>
          </>
        ) : null}
        {present.length > 0 ? (
          <Polyline
            points={points}
            fill="none"
            stroke={colors.text}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
}

/** Month (5): a small trend line, no axes. */
export function Sparkline(props: {
  values: readonly (number | null)[];
  accessibilityLabel: string;
}) {
  const w = 110;
  const h = 36;
  const present = props.values.filter((v): v is number => v != null);
  const min = Math.min(...present);
  const span = Math.max(0.5, Math.max(...present) - min);
  const n = props.values.length;
  const points = props.values
    .map((v, i) =>
      v == null
        ? null
        : `${(2 + (i * (w - 4)) / Math.max(1, n - 1)).toFixed(1)},${(4 + ((Math.max(...present) - v) / span) * (h - 8)).toFixed(1)}`,
    )
    .filter(Boolean)
    .join(' ');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={props.accessibilityLabel}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {present.length > 0 ? (
          <Polyline
            points={points}
            fill="none"
            stroke={colors.text}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
}
