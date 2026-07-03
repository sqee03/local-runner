import { useEffect, useMemo, useState } from "react";
import mqtt from "mqtt";
import {
  configSections,
  getValueAtPath,
  removeValueAtPath,
  setValueAtPath
} from "./config-fields";

function App() {
  const [page, setPage] = useState(() =>
    window.location.pathname.startsWith("/config") ? "config" : "home"
  );
  const [configData, setConfigData] = useState(null);
  const [formState, setFormState] = useState(null);
  const [configStatus, setConfigStatus] = useState("Loading configuration...");
  const [saveState, setSaveState] = useState("idle");
  const [mqttStatus, setMqttStatus] = useState("waiting for configuration");
  const [backendStatus, setBackendStatus] = useState("waiting for message");
  const [lastMessage, setLastMessage] = useState("No message received yet.");

  useEffect(() => {
    const onPopState = () => {
      setPage(window.location.pathname.startsWith("/config") ? "config" : "home");
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
        setConfigStatus(error.message);
      }
    }

    loadConfig();
  }, []);

  const mqttUrl = useMemo(() => {
    if (!configData) {
      return null;
    }

    return `ws://${configData.effective.interfaces.host}:${configData.effective.ports.mqttWs}`;
  }, [configData]);

  const testTopic = configData?.effective?.mqtt?.testTopic ?? "mvp/test";

  useEffect(() => {
    if (!mqttUrl) {
      return undefined;
    }

    const client = mqtt.connect(mqttUrl, {
      reconnectPeriod: 1500,
      connectTimeout: 4000
    });

    setMqttStatus("connecting");
    setBackendStatus("waiting for message");
    setLastMessage("No message received yet.");

    client.on("connect", () => {
      setMqttStatus("connected");
      client.subscribe(testTopic, (error) => {
        if (error) {
          setBackendStatus("subscription failed");
          return;
        }
        setBackendStatus("subscribed, waiting for backend");
      });
    });

    client.on("reconnect", () => {
      setMqttStatus("reconnecting");
    });

    client.on("offline", () => {
      setMqttStatus("offline");
    });

    client.on("error", () => {
      setMqttStatus("failed");
    });

    client.on("message", (topic, payload) => {
      if (topic !== testTopic) {
        return;
      }

      const content = payload.toString();
      setBackendStatus("message received");
      setLastMessage(content);
    });

    return () => {
      client.end(true);
    };
  }, [mqttUrl, testTopic]);

  function navigate(nextPage) {
    const nextPath = nextPage === "config" ? "/config" : "/";
    window.history.pushState({}, "", nextPath);
    setPage(nextPage);
  }

  function handleFieldChange(path, rawValue, type) {
    if (!formState) {
      return;
    }

    if (rawValue === "") {
      setFormState((current) => removeValueAtPath(current, path));
      setSaveState("idle");
      return;
    }

    const parsedValue =
      type === "number" ? Number(rawValue) : rawValue;

    setFormState((current) => setValueAtPath(current, path, parsedValue));
    setSaveState("idle");
  }

  async function saveConfig(event) {
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
      setSaveState(error.message);
    }
  }

  const currentConfigPath = configData?.filePaths?.userConfig ?? "Loading...";
  const defaultConfigPath = configData?.filePaths?.defaultConfig ?? "Loading...";

  return (
    <main className="page-shell">
      <div className="top-actions">
        {page === "home" ? (
          <button className="ghost-button" type="button" onClick={() => navigate("config")}>
            Config
          </button>
        ) : (
          <button className="ghost-button" type="button" onClick={() => navigate("home")}>
            Back
          </button>
        )}
      </div>

      {page === "home" ? (
        <section className="hero-card">
          <p className="eyebrow">FE Package MVP</p>
          <h1>Hello World</h1>
          <p className="lede">
            This page is served locally, connects to MQTT on localhost, and shows
            the latest message from the backend.
          </p>

          <div className="status-grid">
            <article className="status-card">
              <h2>Frontend</h2>
              <p className="status-ok">loaded</p>
            </article>
            <article className="status-card">
              <h2>MQTT</h2>
              <p className={mqttStatus === "connected" ? "status-ok" : "status-warn"}>
                {mqttStatus}
              </p>
            </article>
            <article className="status-card">
              <h2>Backend</h2>
              <p
                className={
                  backendStatus === "message received"
                    ? "status-ok"
                    : "status-warn"
                }
              >
                {backendStatus}
              </p>
            </article>
          </div>

          <article className="message-card">
            <h2>Latest Test Message</h2>
            <pre>{lastMessage}</pre>
          </article>
        </section>
      ) : (
        <section className="config-card">
          <p className="eyebrow">Runner Settings</p>
          <h1>Config</h1>
          <p className="lede">
            Defaults ship in one JSON file, and your local machine-specific overrides
            are saved separately for the next launch.
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
                      const inputValue =
                        overrideValue === undefined ? "" : String(overrideValue);

                      return (
                        <label className="field-card" key={field.path}>
                          <span>{field.label}</span>
                          <input
                            type={field.type}
                            value={inputValue}
                            placeholder={field.placeholder ?? String(effectiveValue ?? "")}
                            onChange={(event) =>
                              handleFieldChange(
                                field.path,
                                event.target.value,
                                field.type
                              )
                            }
                          />
                          <small>Current effective value: {String(effectiveValue ?? "")}</small>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}

              <div className="config-actions">
                <p className="config-hint">
                  Saved values apply on the next runner start because ports and process
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
      )}
    </main>
  );
}

export default App;
