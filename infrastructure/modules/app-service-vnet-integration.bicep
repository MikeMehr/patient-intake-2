// App Service VNet Integration module
// Links the App Service to the app-subnet so all outbound traffic
// routes through the VNet and reaches resources via Private Endpoints

@description('Name of the existing App Service')
param appServiceName string

@description('Resource ID of the app-subnet (delegated to Microsoft.Web/serverFarms)')
param appSubnetId string

resource appService 'Microsoft.Web/sites@2023-01-01' existing = {
  name: appServiceName
}

// VNet integration — routes all outbound traffic through the VNet
resource vnetIntegration 'Microsoft.Web/sites/networkConfig@2023-01-01' = {
  parent: appService
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: appSubnetId
    // Route ALL outbound traffic through VNet (not just RFC-1918)
    swiftSupported: true
  }
}

// NOTE: Do NOT deploy Microsoft.Web/sites/config 'appsettings' here.
// ARM replaces ALL app settings with only the ones specified, wiping existing secrets.
// WEBSITE_VNET_ROUTE_ALL is set via `az webapp config appsettings set` instead.

@description('VNet integration resource ID')
output vnetIntegrationId string = vnetIntegration.id
