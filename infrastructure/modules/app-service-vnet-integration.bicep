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

// App setting to enforce routing all outbound through VNet
resource appSettings 'Microsoft.Web/sites/config@2023-01-01' = {
  parent: appService
  name: 'appsettings'
  properties: {
    WEBSITE_VNET_ROUTE_ALL: '1'
  }
}

@description('VNet integration resource ID')
output vnetIntegrationId string = vnetIntegration.id
