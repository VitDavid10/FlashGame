# Compila el APK firmado de android/ y lo copia a E:\android-tools\apks\<Nombre>.apk
# Uso: tools\android\build-apk.ps1 -Nombre PillWars-1.0.0 [-Url http://localhost:8090/game/]
# Rutas de ESTE PC: JDK y SDK en E:\android-tools (ver android/README.md) y la
# clave de firma fuera del repo, en C:\Users\34679\pillwars-app-signing.
param([Parameter(Mandatory = $true)][string]$Nombre, [string]$Url = '')
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'E:\android-tools\jdk-21.0.12.1+1'
$env:ANDROID_HOME = 'E:\android-tools\sdk'
$env:GRADLE_USER_HOME = 'E:\android-tools\gradle-home'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$firma = 'C:\Users\34679\pillwars-app-signing'
$env:SOLANA_MOBILE_KEYSTORE_PASSWORD = (Get-Content -Raw "$firma\keystore-password.txt").Trim()
$proyecto = 'E:\FlashGame-main_1\FlashGame-main\android'
$args2 = @('assembleRelease', '--console=plain',
    "-PSOLANA_MOBILE_KEYSTORE_PATH=$firma\pillwars-dappstore.keystore",
    '-PSOLANA_MOBILE_KEYSTORE_ALIAS=pillwars',
    # El compilador de Kotlin dentro del proceso de Gradle: un demonio menos en RAM.
    '-Pkotlin.compiler.execution.strategy=in-process')
if ($Url) { $args2 += "-PSOLANA_MOBILE_URL=$Url" }
Push-Location $proyecto
try {
    & "$proyecto\gradlew.bat" @args2
    if ($LASTEXITCODE -ne 0) { throw "gradle salio con $LASTEXITCODE" }
} finally { Pop-Location }
New-Item -ItemType Directory -Force 'E:\android-tools\apks' | Out-Null
$sal = "E:\android-tools\apks\$Nombre.apk"
Copy-Item "$proyecto\app\build\outputs\apk\release\app-release.apk" $sal -Force
Get-Item $sal | Select-Object FullName, Length
