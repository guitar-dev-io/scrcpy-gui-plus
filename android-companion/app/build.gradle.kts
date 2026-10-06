import java.util.Properties
import org.gradle.api.GradleException

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val versionProperties = Properties().apply {
    val versionFile = rootProject.file("version.properties")
    if (versionFile.isFile) {
        versionFile.inputStream().use { load(it) }
    }
}

// Local, developer-only signing overrides. local.properties is gitignored, so credentials placed
// here stay off version control. Environment variables still take precedence (CI is unaffected).
val localProperties = Properties().apply {
    val localFile = rootProject.file("local.properties")
    if (localFile.isFile) {
        localFile.inputStream().use { load(it) }
    }
}
fun signingValue(envName: String, localName: String): String? =
    providers.environmentVariable(envName).orNull?.takeIf { it.isNotBlank() }
        ?: localProperties.getProperty(localName)?.takeIf { it.isNotBlank() }

val androidVersionName = providers.gradleProperty("androidVersionName")
    .orElse(versionProperties.getProperty("versionName", "1.0.0"))
    .get()
val androidVersionCode = providers.gradleProperty("androidVersionCode")
    .orElse(versionProperties.getProperty("versionCode", "1"))
    .get()
    .toInt()

if (androidVersionCode <= 0) {
    throw GradleException("androidVersionCode must be a positive integer")
}

val releaseSigningRequired =
    providers.gradleProperty("androidReleaseSigningRequired").orNull == "true"
val releaseKeystorePath =
    signingValue("ANDROID_RELEASE_KEYSTORE_PATH", "androidRelease.keystorePath")
val releaseStorePassword =
    signingValue("ANDROID_RELEASE_STORE_PASSWORD", "androidRelease.storePassword")
val releaseKeyAlias = signingValue("ANDROID_RELEASE_KEY_ALIAS", "androidRelease.keyAlias")
val releaseKeyPassword =
    signingValue("ANDROID_RELEASE_KEY_PASSWORD", "androidRelease.keyPassword")
val releaseKeystoreFile = releaseKeystorePath?.let { rootProject.file(it) }
val releaseSigningConfigured = listOf(
    releaseKeystorePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

if (releaseSigningRequired && !releaseSigningConfigured) {
    throw GradleException(
        "Android release signing is required, but one or more signing environment variables are missing",
    )
}

if (releaseSigningConfigured && releaseKeystoreFile?.isFile != true) {
    throw GradleException("Android release keystore was not found: $releaseKeystorePath")
}

android {
    namespace = "com.scrcpyguiplus.companion"
    compileSdk = 36

    buildFeatures {
        buildConfig = true
        compose = true
    }

    defaultConfig {
        applicationId = "com.scrcpyguiplus.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = androidVersionCode
        versionName = androidVersionName

        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = releaseKeystoreFile!!
                storePassword = releaseStorePassword!!
                keyAlias = releaseKeyAlias!!
                keyPassword = releaseKeyPassword!!
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")

    val composeBom = platform("androidx.compose:compose-bom:2025.09.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.9.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    // Android provides org.json at runtime; this pinned implementation runs protocol tests on JVM.
    testImplementation("org.json:json:20240303")
}
