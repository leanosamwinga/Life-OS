import { Card, Row } from '@/components/ui';
import { ComingSoonStep } from '@/features/onboarding/ComingSoonStep';
import { useSession } from '@/lib/session';

/** 0d Connect Apple Health (iPhone only). HealthKit permission arrives in phase 3. */
export default function AppleHealthStep() {
  const session = useSession();
  return (
    <ComingSoonStep
      step="apple-health"
      testID="screen-onboarding-apple-health"
      title="Connect Apple Health"
      body="Life OS reads these to fill your rings and Health tab. It never writes to Apple Health."
      nextNote="Next, iOS will show its own Health permissions sheet, where you can switch each item on or off."
      save={(choice) =>
        session.updateSettings({ appleHealthChoice: choice === 'yes' ? 'connect' : 'not_now' })
      }
    >
      <Card>
        <Row label="Steps" detail="Today ring" />
        <Row label="Sleep" detail="Today ring, briefing" />
        <Row label="Weight" detail="Health trend" />
        <Row label="Workouts" detail="Training rotation" last />
      </Card>
    </ComingSoonStep>
  );
}
