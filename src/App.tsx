import { type FormEvent, useEffect, useRef, useState } from "react";
import packageMetadata from "../package.json";
import {
  type ConfigFieldType,
  type JsonObject,
  type JsonValue,
  configSections,
  getValueAtPath,
  removeValueAtPath,
  setValueAtPath
} from "./config-fields";

type Page = "config" | "desktop-config" | "desktop-simulator" | "home";
type SaveState = "idle" | "saved" | "saving" | string;
type CopyState = "copied" | "failed" | "idle";
type PackageName = "be" | "fe" | "mqtt";
type PackageStatus = "running" | "starting" | "stopped" | "stopping";

interface ConfigResponse {
  readonly defaults: JsonObject;
  readonly userOverrides: JsonObject;
  readonly effective: JsonObject;
  readonly filePaths?: {
    readonly defaultConfig?: string;
    readonly userConfig?: string;
  };
}

interface RuntimeConfig extends JsonObject {
  readonly frontendAppUrl?: string;
}

interface RuntimeState {
  readonly isRunning: boolean;
  readonly isTransitioning: boolean;
  readonly lastError: string | null;
  readonly currentConfig: RuntimeConfig | null;
  readonly packageStatus: Partial<Record<PackageName, PackageStatus>>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolvePage(pathname: string): Page {
  if (pathname.startsWith("/desktop/config")) {
    return "desktop-config";
  }

  if (pathname.startsWith("/desktop/simulator")) {
    return "desktop-simulator";
  }

  if (pathname.startsWith("/config")) {
    return "config";
  }

  return "home";
}

function resolveDocumentTitle(page: Page, appVersion: string): string {
  if (page === "config" || page === "desktop-config") {
    return `v${appVersion} - Config`;
  }

  if (page === "desktop-simulator") {
    return `v${appVersion} - Simulator`;
  }

  return `v${appVersion}`;
}

function App() {
  const appVersion = packageMetadata.version;
  const frontendWindowRef = useRef<Window | null>(null);
  const [page, setPage] = useState(() => resolvePage(window.location.pathname));
  const [configData, setConfigData] = useState<ConfigResponse | null>(null);
  const [formState, setFormState] = useState<JsonObject | null>(null);
  const [configStatus, setConfigStatus] = useState("Loading configuration...");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({
    isRunning: false,
    isTransitioning: false,
    lastError: null,
    currentConfig: null,
    packageStatus: {}
  });
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const isDesktopShell = page.startsWith("desktop-");
  const isConfigPage = page === "config" || page === "desktop-config";
  const isDesktopSimulatorPage = page === "desktop-simulator";

  useEffect(() => {
    const onPopState = () => {
      setPage(resolvePage(window.location.pathname));
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.title = resolveDocumentTitle(page, appVersion);
  }, [page, appVersion]);

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch("/api/config");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load config.");
        }

        setConfigData(payload);
        setFormState(payload.userOverrides);
        setConfigStatus("Configuration loaded.");
      } catch (error) {
        setConfigStatus(errorMessage(error));
      }
    }

    loadConfig();
  }, []);

  useEffect(() => {
    async function loadRuntime() {
      try {
        const response = await fetch("/api/runtime");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load runtime status.");
        }

        setRuntimeState(payload);
      } catch (error) {
        setRuntimeState((current) => ({
          ...current,
          lastError: errorMessage(error)
        }));
      }
    }

    loadRuntime();
    const timer = window.setInterval(loadRuntime, 2000);
    return () => window.clearInterval(timer);
  }, []);

  function tryOpenFrontend(url: string): Window | null {
    const openedWindow = window.open(url, "package-simulator-fe");
    frontendWindowRef.current = openedWindow;
    return openedWindow;
  }

  function navigate(nextPage: Page) {
    const nextPath =
      nextPage === "config"
        ? "/config"
        : nextPage === "desktop-config"
          ? "/desktop/config"
          : nextPage === "desktop-simulator"
            ? "/desktop/simulator"
            : "/";

    window.history.pushState({}, "", nextPath);
    setPage(nextPage);
  }

  function handleFieldChange(path: string, rawValue: JsonValue, type: ConfigFieldType) {
    if (!formState) {
      return;
    }

    if (type === "checkbox") {
      setFormState((current) =>
        current ? setValueAtPath(current, path, rawValue) : current
      );
      setSaveState("idle");
      return;
    }

    if (rawValue === "") {
      setFormState((current) => (current ? removeValueAtPath(current, path) : current));
      setSaveState("idle");
      return;
    }

    const parsedValue = type === "number" ? Number(rawValue) : rawValue;
    setFormState((current) =>
      current ? setValueAtPath(current, path, parsedValue) : current
    );
    setSaveState("idle");
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState("saving");

    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ userOverrides: formState })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save config.");
      }

      setConfigData(payload);
      setFormState(payload.userOverrides);
      setSaveState("saved");
    } catch (error) {
      setSaveState(errorMessage(error));
    }
  }

  async function toggleRuntime() {
    const nextAction = runtimeState.isRunning ? "stop" : "start";

    try {
      const response = await fetch(`/api/runtime/${nextAction}`, {
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${nextAction} runtime.`);
      }

      if (
        nextAction === "start" &&
        payload.currentConfig?.frontendAppUrl &&
        !isDesktopShell
      ) {
        tryOpenFrontend(payload.currentConfig.frontendAppUrl);
      }

      if (
        nextAction === "stop" &&
        frontendWindowRef.current &&
        !frontendWindowRef.current.closed
      ) {
        frontendWindowRef.current.close();
        frontendWindowRef.current = null;
      }

      setRuntimeState(payload);
    } catch (error) {
      setRuntimeState((current) => ({
        ...current,
        lastError: errorMessage(error)
      }));
    }
  }

  async function copyFrontendUrl() {
    if (!runtimeState.currentConfig?.frontendAppUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(runtimeState.currentConfig.frontendAppUrl);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1600);
    }
  }

  function renderRuntimeStatusText() {
    if (runtimeState.lastError) {
      return `Simulator error: ${runtimeState.lastError}`;
    }

    if (runtimeState.isTransitioning) {
      return runtimeState.isRunning
        ? "Runtime is stopping..."
        : "Runtime is starting...";
    }

    return runtimeState.isRunning
      ? "Injected FE, BE, and MQTT packages are active."
      : "Simulator is ready. Start the runtime to load the injected app.";
  }

  function renderConfigForm() {
    const currentConfigPath = configData?.filePaths?.userConfig ?? "Loading...";
    const defaultConfigPath = configData?.filePaths?.defaultConfig ?? "Loading...";

    return (
      <section className={isDesktopShell ? "config-card desktop-surface" : "config-card"}>
        <p className="eyebrow">Simulator Settings</p>
        <div className="title-row">
          <h1>Config</h1>
          <span className="version-badge">v{appVersion}</span>
        </div>
        <p className="lede">
          Defaults ship in one JSON file, and your local machine-specific overrides
          are saved separately for the next desktop app launch or service restart.
        </p>

        <div className="config-meta">
          <p><strong>Defaults:</strong> {defaultConfigPath}</p>
          <p><strong>User overrides:</strong> {currentConfigPath}</p>
          <p><strong>Status:</strong> {configStatus}</p>
        </div>

        {formState ? (
          <form className="config-form" onSubmit={saveConfig}>
            {configSections.map((section) => (
              <section className="config-section" key={section.title}>
                <div className="config-section-copy">
                  <h2>{section.title}</h2>
                  <p>{section.description}</p>
                </div>

                <div className="field-grid">
                  {section.fields.map((field) => {
                    const overrideValue = getValueAtPath(formState, field.path);
                    const effectiveValue = getValueAtPath(
                      configData?.effective ?? {},
                      field.path
                    );
                    return (
                      <label className="field-card" key={field.path}>
                        <span>{field.label}</span>
                        {field.type === "checkbox" ? (
                          <input
                            className="toggle-input"
                            type="checkbox"
                            checked={Boolean(
                              overrideValue === undefined ? effectiveValue : overrideValue
                            )}
                            onChange={(event) =>
                              handleFieldChange(
                                field.path,
                                event.target.checked,
                                field.type
                              )
                            }
                          />
                        ) : (
                          <input
                            type={field.type}
                            value={
                              overrideValue === undefined ? "" : String(overrideValue)
                            }
                            placeholder={field.placeholder ?? String(effectiveValue ?? "")}
                            onChange={(event) =>
                              handleFieldChange(
                                field.path,
                                event.target.value,
                                field.type
                              )
                            }
                          />
                        )}
                        <small>Current effective value: {String(effectiveValue ?? "")}</small>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}

            <div className="config-actions">
              <p className="config-hint">
                Saved values apply the next time services start because ports and process
                paths are used during boot.
              </p>
              <button className="primary-button" type="submit">
                Save overrides
              </button>
              <span className="save-status">
                {saveState === "idle"
                  ? "No unsaved status."
                  : saveState === "saving"
                    ? "Saving..."
                    : saveState === "saved"
                      ? "Saved."
                      : saveState}
              </span>
            </div>
          </form>
        ) : (
          <article className="message-card">
            <h2>Configuration</h2>
            <pre>{configStatus}</pre>
          </article>
        )}
      </section>
    );
  }

  function renderDesktopSimulator() {
    const frontendUrl = runtimeState.currentConfig?.frontendAppUrl;

    if (runtimeState.isRunning && frontendUrl) {
      return (
        <section className="desktop-app-shell">
          <iframe
            className="desktop-app-frame"
            key={frontendUrl}
            src={frontendUrl}
            title="Package Simulator"
          />
        </section>
      );
    }

    return (
      <main className="page-shell desktop-page-shell">
        <section className="desktop-shell">
          <article className="desktop-placeholder">
            <h2>Simulator waiting for runtime</h2>
            <p>
              Start the runtime to launch FE, BE, and MQTT, then the Simulator
              will appear directly in this window.
            </p>
          </article>
        </section>
      </main>
    );
  }

  if (isDesktopShell) {
    if (isDesktopSimulatorPage) {
      return renderDesktopSimulator();
    }

    return (
      <main className="page-shell desktop-page-shell">
        <section className="desktop-shell">
          {renderConfigForm()}
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <div className="top-actions">
        {isConfigPage ? (
          <button className="ghost-button" type="button" onClick={() => navigate("home")}>
            Back
          </button>
        ) : (
          <button className="ghost-button" type="button" onClick={() => navigate("config")}>
            Config
          </button>
        )}
      </div>

      {!isConfigPage ? (
        <section className="hero-card">
          <p className="eyebrow">Simulator control tool</p>
          <div className="title-row">
            <h1>Package Simulator</h1>
            <span className="version-badge">v{appVersion}</span>
          </div>
          <p className="lede">
            This simulator controls separate FE, BE, and MQTT packages. The frontend
            package launches on its own port as an injected application.
          </p>

          <div className="simulator-actions">
            <div className="simulator-action-row">
              <button
                className={runtimeState.isRunning ? "simulator-button stop" : "simulator-button start"}
                type="button"
                onClick={toggleRuntime}
                disabled={runtimeState.isTransitioning}
              >
                {runtimeState.isTransitioning
                  ? runtimeState.isRunning
                    ? "Stopping..."
                    : "Starting..."
                  : runtimeState.isRunning
                    ? "Stop"
                    : "Start"}
              </button>

              {runtimeState.isRunning && runtimeState.currentConfig?.frontendAppUrl ? (
                <div className="app-ready">
                  <span>
                    App ready at{" "}
                    <a
                      href={runtimeState.currentConfig.frontendAppUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {runtimeState.currentConfig.frontendAppUrl}
                    </a>
                  </span>
                  <button
                    className="copy-button"
                    type="button"
                    onClick={copyFrontendUrl}
                    aria-label="Copy app URL"
                    title={copyState === "copied" ? "Copied" : "Copy URL"}
                  >
                    {copyState === "copied" ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : null}
            </div>
            <p className="simulator-hint">{renderRuntimeStatusText()}</p>
          </div>

          <div className="status-grid">
            <article className="status-card">
              <h2>Frontend Package</h2>
              <p className={runtimeState.packageStatus?.fe === "running" ? "status-ok" : "status-warn"}>
                {runtimeState.packageStatus?.fe ?? "stopped"}
              </p>
            </article>
            <article className="status-card">
              <h2>MQTT Package</h2>
              <p className={runtimeState.packageStatus?.mqtt === "running" ? "status-ok" : "status-warn"}>
                {runtimeState.packageStatus?.mqtt ?? "stopped"}
              </p>
            </article>
            <article className="status-card">
              <h2>Backend Package</h2>
              <p className={runtimeState.packageStatus?.be === "running" ? "status-ok" : "status-warn"}>
                {runtimeState.packageStatus?.be ?? "stopped"}
              </p>
            </article>
          </div>
        </section>
      ) : (
        renderConfigForm()
      )}
    </main>
  );
}

export default App;
