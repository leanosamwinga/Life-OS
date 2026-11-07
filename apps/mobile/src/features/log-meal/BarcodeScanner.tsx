import { useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** Food packaging barcodes (EAN/UPC). QR codes are ignored. */
const FOOD_BARCODES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e'];

/**
 * Camera viewfinder for 7c. Calls `onBarcode` once per scan; pass `paused` while looking it up.
 * Works on iOS, Android and web (the browser asks for camera access).
 */
export function BarcodeScanner({
  onBarcode,
  paused,
}: {
  onBarcode: (code: string) => void;
  paused: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<{ code: string; at: number } | null>(null);

  const handle = ({ data }: { data: string }) => {
    const code = data.replace(/\D/g, '');
    const now = Date.now();
    // The camera reports the same code many times a second; act on it once.
    if (last.current && last.current.code === code && now - last.current.at < 3000) return;
    last.current = { code, at: now };
    onBarcode(code);
  };

  if (!permission?.granted) {
    const canAsk = permission?.canAskAgain !== false;
    return (
      <View style={styles.box} testID="scanner-permission">
        <Text style={styles.boxText}>Camera access lets you scan barcodes on food packs.</Text>
        <Pressable
          onPress={() => void (canAsk ? requestPermission() : Linking.openSettings())}
          accessibilityRole="button"
          accessibilityLabel={canAsk ? 'Allow camera' : 'Open Settings to allow the camera'}
          style={styles.allow}
        >
          <Text style={styles.allowText}>{canAsk ? 'Allow camera' : 'Open Settings'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.box} accessible accessibilityLabel="Barcode scanner. Point at the barcode.">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: FOOD_BARCODES }}
        onBarcodeScanned={paused ? undefined : handle}
      />
      <View style={styles.frame} pointerEvents="none">
        <View style={styles.line} />
      </View>
      <Text style={styles.hint} pointerEvents="none">
        {paused ? 'Looking it up…' : 'Point at the barcode'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 280,
    borderRadius: radius.lg,
    backgroundColor: colors.fill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.lg,
  },
  boxText: { ...type.callout, color: colors.inverseText, textAlign: 'center' },
  allow: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  allowText: { ...type.headline, color: colors.text },
  frame: {
    width: '70%',
    height: 110,
    borderWidth: 3,
    borderColor: colors.inverseText,
    borderRadius: radius.sm,
    justifyContent: 'center',
    opacity: 0.9,
  },
  line: { height: 2, backgroundColor: colors.inverseText, marginHorizontal: space.md },
  hint: { ...type.headline, color: colors.inverseText, position: 'absolute', bottom: space.xl },
});
