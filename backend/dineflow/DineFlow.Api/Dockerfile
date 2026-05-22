FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY DineFlow.sln ./
COPY DineFlow.Api/DineFlow.Api.csproj DineFlow.Api/
COPY DineFlow.Application/DineFlow.Application.csproj DineFlow.Application/
COPY DineFlow.Domain/DineFlow.Domain.csproj DineFlow.Domain/
COPY DineFlow.Infrastructure/DineFlow.Infrastructure.csproj DineFlow.Infrastructure/
RUN dotnet restore DineFlow.Api/DineFlow.Api.csproj

COPY . .
WORKDIR /src/DineFlow.Api
RUN dotnet publish DineFlow.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

EXPOSE 8080
ENTRYPOINT ["dotnet", "DineFlow.Api.dll"]
