import { AboutSection } from './about-section';
import { StartPageSection } from './start-page-section';

/** Settings > General: the start page of new sessions, and what this install is. */
export function GeneralPage() {
  return (
    <>
      <StartPageSection />
      <AboutSection />
    </>
  );
}
