import type { ConnectorDef } from "./types";
import { githubConnector } from "./connectors/github";
import { vercelConnector, netlifyConnector, plannedHosting } from "./connectors/hosting";
import { stripeConnector, mercadoPagoConnector } from "./connectors/payments";
import { metaAdsConnector, googleAdsConnector, ga4Connector } from "./connectors/marketing";
import { localFoldersConnector, csvConnector, monitoringConnector, fxConnector, aiConnector } from "./connectors/local";

/** Adding an integration = adding a ConnectorDef here. No other module needs to change. */
export const CONNECTORS: ConnectorDef[] = [
  githubConnector,
  localFoldersConnector,
  csvConnector,
  mercadoPagoConnector,
  stripeConnector,
  metaAdsConnector,
  vercelConnector,
  ga4Connector,
  monitoringConnector,
  aiConnector,
  fxConnector,
  netlifyConnector,
  googleAdsConnector,
  ...plannedHosting,
];

export const connector = (id: string) => CONNECTORS.find((c) => c.id === id);
