import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/theme';

/**
 * Line chart with a soft fill (S04 3-month chart, LLD §4.4). Green when the last value is at or
 * above the first, red otherwise. Decorative: the price card carries the numbers.
 */
export function PriceChart({
  values,
  height = 120,
}: {
  readonly values: readonly number[];
  readonly height?: number;
}): React.JSX.Element {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent): void => setWidth(Math.round(e.nativeEvent.layout.width));

  let line = '';
  let area = '';
  if (width > 0 && values.length > 1) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 4;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    line = `M${pts.join(' L')}`;
    area = `${line} L${width},${height} L0,${height} Z`;
  }
  const up = (values.at(-1) ?? 0) >= (values[0] ?? 0);
  const stroke = up ? colors.gain : colors.loss;

  return (
    <View
      style={[styles.wrap, { height }]}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {line ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={stroke} stopOpacity={0.25} />
              <Stop offset="1" stopColor={stroke} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { width: '100%' } });
