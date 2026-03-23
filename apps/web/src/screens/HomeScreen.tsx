import { useEffect, useState } from "react";
import type { GeneratedCatalog } from "@pianio/content-schema";
import { describeMidiSupport } from "@pianio/midi-web";

const workstreams = [
  "Thread 1: contracts, generator, and architecture decisions",
  "Thread 2: web shell and exercise screen UX",
  "Thread 3: browser MIDI diagnostics and Launchkey validation",
  "Thread 4: notation rendering and cursor playback",
  "Thread 5: assessment engine for practice mode",
  "Thread 6: content authoring and lesson notes",
  "Thread 7: Firebase deployment and release automation"
] as const;

export function HomeScreen() {
  const [catalog, setCatalog] = useState<GeneratedCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const midi = describeMidiSupport();

  useEffect(() => {
    let active = true;

    fetch("/generated/catalog.json")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Catalog request failed with ${response.status}`);
        }

        return (await response.json()) as GeneratedCatalog;
      })
      .then((data) => {
        if (active) {
          setCatalog(data);
        }
      })
      .catch((fetchError) => {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="screen-stack">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Open piano learning, built for the browser</span>
          <h1>Pianio</h1>
          <p>
            A web-first piano learning platform focused on method and technique, deployable
            as a static app and designed to scale into community-authored open content.
          </p>
          <div className="button-row">
            <a className="action-button" href="#/diagnostics">
              Open MIDI diagnostics
            </a>
          </div>
        </div>
        <div className="panel status-card">
          <h2>Browser MIDI</h2>
          <p className={midi.available ? "status ok" : "status warn"}>{midi.summary}</p>
          <p>{midi.detail}</p>
          <p className="hint">
            Phase 1 support target: desktop Chrome over HTTPS for real-device testing.
          </p>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Project shape</h2>
          <ul>
            <li>Static Vite SPA suitable for Firebase Hosting</li>
            <li>Generated course catalog plus MusicXML score assets</li>
            <li>Original starter content to avoid licensing ambiguity</li>
            <li>Packages reserved for MIDI, notation, and assessment logic</li>
          </ul>
        </article>

        <article className="panel">
          <h2>Parallel threads</h2>
          <ul>
            {workstreams.map((stream) => (
              <li key={stream}>{stream}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Starter curriculum</span>
            <h2>Generated course catalog</h2>
          </div>
          {catalog ? <p>{catalog.generatedAt}</p> : null}
        </div>

        {error ? <p className="status warn">{error}</p> : null}
        {!catalog && !error ? <p>Loading generated content...</p> : null}

        {catalog ? (
          <div className="course-list">
            {catalog.courses.map((course) => (
              <article className="course-card" key={course.id}>
                <div className="course-heading">
                  <div>
                    <h3>{course.title}</h3>
                    <p>{course.summary}</p>
                  </div>
                  <span className="pill">{course.exerciseCount} exercises</span>
                </div>

                <div className="course-meta">
                  <span>Level {course.level}</span>
                  <span>{course.sourcePolicy.replaceAll("_", " ")}</span>
                </div>

                <ol className="exercise-list">
                  {course.exercises.slice(0, 5).map((exercise) => (
                    <li key={exercise.id}>
                      <div>
                        <strong>{exercise.title}</strong>
                        <p>{exercise.goal}</p>
                      </div>
                      <div className="exercise-meta">
                        <span>{exercise.hands} hand</span>
                        <span>{exercise.tempoBpm} bpm</span>
                        <a href={exercise.scorePath} target="_blank" rel="noreferrer">
                          MusicXML
                        </a>
                      </div>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
