import { StyleSheet, View, type ColorValue } from 'react-native';

/**
 * Tab icons drawn from plain Views.
 *
 * `@expo/vector-icons` does not resolve cleanly against React 19 in this SDK,
 * and forcing an incorrect peer resolution into a banking app is not a good
 * trade. These few shapes need no icon font, cannot fail to load, and render
 * identically on iOS and Android.
 */

export type IconName =
  | 'home'
  | 'exchange'
  | 'activity'
  | 'person'
  | 'people'
  | 'approve';

export function Icon({
  name,
  color,
  size = 22,
}: {
  name: IconName;
  color: ColorValue;
  size?: number;
}) {
  switch (name) {
    case 'home':
      return (
        <View style={[styles.box, { width: size, height: size }]}>
          <View
            style={[
              styles.roof,
              {
                borderLeftWidth: size / 2,
                borderRightWidth: size / 2,
                borderBottomWidth: size / 2.4,
                borderBottomColor: color,
              },
            ]}
          />
          <View
            style={{
              width: size * 0.68,
              height: size * 0.44,
              backgroundColor: color,
              borderBottomLeftRadius: 2,
              borderBottomRightRadius: 2,
            }}
          />
        </View>
      );

    case 'exchange':
      return (
        <View style={[styles.box, { width: size, height: size, gap: 3 }]}>
          <View
            style={{
              width: size * 0.85,
              height: 2.5,
              backgroundColor: color,
              borderRadius: 2,
            }}
          />
          <View
            style={{
              width: size * 0.85,
              height: 2.5,
              backgroundColor: color,
              borderRadius: 2,
            }}
          />
          <View
            style={{
              width: size * 0.5,
              height: 2.5,
              backgroundColor: color,
              borderRadius: 2,
            }}
          />
        </View>
      );

    case 'activity':
      return (
        <View
          style={[
            styles.row,
            { width: size, height: size, gap: 3, alignItems: 'flex-end' },
          ]}
        >
          {[0.4, 0.75, 0.55, 1].map((scale, index) => (
            <View
              key={index}
              style={{
                width: 3.5,
                height: size * scale,
                backgroundColor: color,
                borderRadius: 2,
              }}
            />
          ))}
        </View>
      );

    case 'approve':
      // A tick, drawn as two rotated bars.
      return (
        <View style={[styles.box, { width: size, height: size }]}>
          <View
            style={{
              width: size * 0.34,
              height: 2.8,
              backgroundColor: color,
              borderRadius: 2,
              position: 'absolute',
              transform: [
                { translateX: -size * 0.17 },
                { translateY: size * 0.1 },
                { rotate: '45deg' },
              ],
            }}
          />
          <View
            style={{
              width: size * 0.62,
              height: 2.8,
              backgroundColor: color,
              borderRadius: 2,
              position: 'absolute',
              transform: [
                { translateX: size * 0.08 },
                { rotate: '-45deg' },
              ],
            }}
          />
        </View>
      );

    case 'people':
      return (
        <View style={[styles.row, { width: size, height: size, gap: 2 }]}>
          <PersonGlyph color={color} size={size * 0.78} />
          <PersonGlyph color={color} size={size * 0.78} />
        </View>
      );

    case 'person':
    default:
      return (
        <View style={[styles.box, { width: size, height: size }]}>
          <PersonGlyph color={color} size={size} />
        </View>
      );
  }
}

function PersonGlyph({ color, size }: { color: ColorValue; size: number }) {
  return (
    <View style={[styles.box, { gap: 1.5 }]}>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.42,
          borderRadius: size,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: size * 0.74,
          height: size * 0.36,
          borderTopLeftRadius: size,
          borderTopRightRadius: size,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  roof: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
