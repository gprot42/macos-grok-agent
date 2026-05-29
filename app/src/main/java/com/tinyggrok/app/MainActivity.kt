package com.tinyggrok.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.compose.rememberNavController
import com.tinyggrok.app.data.local.SettingsRepository
import com.tinyggrok.app.ui.navigation.AppNavigation
import com.tinyggrok.app.ui.theme.AppTheme
import com.tinyggrok.app.ui.theme.TinyGrokTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var settingsRepository: SettingsRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val theme by settingsRepository.theme.collectAsState(initial = AppTheme.DARK)
            TinyGrokTheme(appTheme = theme) {
                val navController = rememberNavController()
                AppNavigation(navController = navController)
            }
        }
    }
}
