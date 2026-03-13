// NSG module — Network Security Group for app-subnet
// Inbound: Allow HTTPS from Internet to App Service; deny all else
// Outbound: Allow to Private Endpoints subnet, Azure Monitor, Key Vault; deny Internet

@description('Azure region for all resources')
param location string

@description('Name prefix for all resources')
param namePrefix string

@description('Address prefix of the Private Endpoint subnet (for outbound allow rule)')
param peSubnetPrefix string = '10.0.1.0/24'

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-05-01' = {
  name: '${namePrefix}-app-nsg'
  location: location
  properties: {
    securityRules: [
      // ── Inbound ──────────────────────────────────────────────────────────
      {
        name: 'Allow-HTTPS-Inbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
          description: 'Allow HTTPS traffic from Internet to App Service'
        }
      }
      {
        name: 'Allow-AzureLoadBalancer-Inbound'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: 'AzureLoadBalancer'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
          description: 'Allow Azure Load Balancer health probes'
        }
      }
      {
        name: 'Deny-All-Inbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
          description: 'Deny all other inbound traffic'
        }
      }

      // ── Outbound ─────────────────────────────────────────────────────────
      {
        name: 'Allow-PrivateEndpoints-Outbound'
        properties: {
          priority: 100
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: peSubnetPrefix
          destinationPortRange: '*'
          description: 'Allow outbound to Private Endpoints subnet (DB, KeyVault, AI, Speech)'
        }
      }
      {
        name: 'Allow-AzureMonitor-Outbound'
        properties: {
          priority: 110
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'AzureMonitor'
          destinationPortRange: '443'
          description: 'Allow Application Insights / Azure Monitor telemetry'
        }
      }
      {
        name: 'Allow-AzureActiveDirectory-Outbound'
        properties: {
          priority: 120
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'AzureActiveDirectory'
          destinationPortRange: '443'
          description: 'Allow AAD / Managed Identity token endpoint'
        }
      }
      {
        name: 'Allow-AzureKeyVault-Outbound'
        properties: {
          priority: 130
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'AzureKeyVault'
          destinationPortRange: '443'
          description: 'Allow Key Vault service tag (fallback if PE not yet active)'
        }
      }
      {
        name: 'Allow-ExternalAPIs-HTTPS-Outbound'
        properties: {
          priority: 200
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Internet'
          destinationPortRange: '443'
          description: 'Allow outbound HTTPS to external APIs (Resend, Google OAuth). Non-443 blocked.'
        }
      }
      {
        name: 'Deny-Internet-Outbound'
        properties: {
          priority: 4096
          direction: 'Outbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Internet'
          destinationPortRange: '*'
          description: 'Deny all outbound Internet traffic (force through Private Endpoints)'
        }
      }
    ]
  }
}

@description('NSG resource ID')
output nsgId string = nsg.id

@description('NSG name')
output nsgName string = nsg.name
