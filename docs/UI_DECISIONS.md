# UI decisions

- The dashboard's weekly sales bars use a calculated inline height because each bar represents a different amount. The value is bounded to 0–100 percent and comes from integer-cent sales data; replacing it with a fixed class would lose the data visualization. This is the one intentional inline-style audit warning.
- Audit steps that need local services are environment-dependent. The browser audit and screenshots need a local listening port plus Chromium; API load checks need a running API. A skipped check is not evidence that those live-service paths passed.
- The app uses the self-hosted Noto Sans and Noto Serif files already included in the repository. The UI audit accepts those families because the spec allows a system UI font and a self-hosted brand display font.
