import DeviceCompatibilityOverlay from '@/components/device-compatibility-overlay';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <DeviceCompatibilityOverlay />
      {children}
    </>
  );
}
