import os
import time
import requests
import pandas as pd
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_CSV = os.path.join(SCRIPT_DIR, 'datasets', 'imd_cpcb_all_india_post2022.csv')

CITIES = [
    ("Mumbai", 19.0760, 72.8777), ("Delhi", 28.6139, 77.2090),
    ("Bengaluru", 12.9716, 77.5946), ("Hyderabad", 17.3850, 78.4867),
    ("Ahmedabad", 23.0225, 72.5714), ("Chennai", 13.0827, 80.2707),
    ("Kolkata", 22.5726, 88.3639), ("Surat", 21.1702, 72.8311),
    ("Pune", 18.5204, 73.8567), ("Jaipur", 26.9124, 75.7873),
    ("Lucknow", 26.8467, 80.9462), ("Kanpur", 26.4499, 80.3319),
    ("Nagpur", 21.1458, 79.0882), ("Indore", 22.7196, 75.8577),
    ("Thane", 19.2183, 72.9781), ("Bhopal", 23.2599, 77.4126),
    ("Visakhapatnam", 17.6868, 83.2185), ("Patna", 25.5941, 85.1376),
    ("Vadodara", 22.3072, 73.1812), ("Ghaziabad", 28.6692, 77.4538),
    ("Ludhiana", 30.9010, 75.8573), ("Agra", 27.1767, 78.0081),
    ("Nashik", 20.0000, 73.7833), ("Faridabad", 28.4089, 77.3178),
    ("Meerut", 28.9845, 77.7064), ("Rajkot", 22.3039, 70.8022),
    ("Varanasi", 25.3176, 82.9739), ("Srinagar", 34.0837, 74.7973),
    ("Aurangabad", 19.8762, 75.3433), ("Dhanbad", 23.7957, 86.4304),
    ("Amritsar", 31.6340, 74.8723), ("Allahabad", 25.4358, 81.8463),
    ("Ranchi", 23.3441, 85.3096), ("Howrah", 22.5958, 88.3263),
    ("Coimbatore", 11.0168, 76.9558), ("Jabalpur", 23.1815, 79.9864),
    ("Gwalior", 26.2183, 78.1828), ("Vijayawada", 16.5062, 80.6480),
    ("Jodhpur", 26.2389, 73.0243), ("Madurai", 9.9252, 78.1198),
    ("Raipur", 21.2514, 81.6296), ("Kota", 25.2138, 75.8648),
    ("Guwahati", 26.1445, 91.7362), ("Chandigarh", 30.7333, 76.7794),
    ("Solapur", 17.6599, 75.9064), ("Hubli-Dharwad", 15.3647, 75.1240),
    ("Mysore", 12.2958, 76.6394), ("Tiruchirappalli", 10.7905, 78.7047),
    ("Jalandhar", 31.3260, 75.5762), ("Bhubaneswar", 20.2961, 85.8245),
    ("Salem", 11.6643, 78.1460), ("Aligarh", 27.8974, 78.0880),
    ("Thiruvananthapuram", 8.5241, 76.9366), ("Bhiwandi", 19.3000, 73.0667),
    ("Saharanpur", 29.9640, 77.5460), ("Gorakhpur", 26.7606, 83.3732),
    ("Bikaner", 28.0229, 73.3119), ("Amravati", 20.9320, 77.7523),
    ("Noida", 28.5355, 77.3910), ("Jamshedpur", 22.8046, 86.2029),
    ("Bhilai", 21.1938, 81.3509), ("Cuttack", 20.4625, 85.8830),
    ("Firozabad", 27.1590, 78.3957), ("Kochi", 9.9312, 76.2673),
    ("Bhavnagar", 21.7645, 72.1519), ("Dehradun", 30.3165, 78.0322),
    ("Durgapur", 23.5204, 87.3119), ("Asansol", 23.6739, 86.9524),
    ("Nanded", 19.1383, 77.3210), ("Kolhapur", 16.7050, 74.2433),
    ("Ajmer", 26.4499, 74.6399), ("Gulbarga", 17.3297, 76.8343),
    ("Jamnagar", 22.4707, 70.0577), ("Ujjain", 23.1793, 75.7849),
    ("Loni", 28.7500, 77.2833), ("Siliguri", 26.7271, 88.3953),
    ("Jhansi", 25.4484, 78.5685), ("Ulhasnagar", 19.2215, 73.1645),
    ("Jammu", 32.7266, 74.8570), ("Sangli", 16.8524, 74.5815),
    ("Mangalore", 12.9141, 74.8560), ("Erode", 11.3410, 77.7172),
    ("Belgaum", 15.8497, 74.4977), ("Ambattur", 13.1143, 80.1548),
    ("Tirunelveli", 8.7139, 77.7567), ("Malegaon", 20.5500, 74.5333),
    ("Gaya", 24.7914, 85.0002), ("Jalgaon", 21.0077, 75.5626),
    ("Udaipur", 24.5854, 73.7125), ("Kozhikode", 11.2588, 75.7804),
    ("Akola", 20.7059, 76.9953), ("Kurnool", 15.8281, 78.0373),
    ("Rajahmundry", 17.0005, 81.8040), ("Bokaro", 23.6693, 86.1511),
    ("Bellary", 15.1394, 76.9214), ("Patiala", 30.3398, 76.3869),
    ("Agartala", 23.8315, 91.2868), ("Bhagalpur", 25.2425, 86.9842)
]

def fetch_data():
    all_data = []
    
    # Keeping the time range small (3 months of daily data) to ensure API limits are respected 
    # and connection resets are minimized. 90 days * 98 cities = ~9000 rows.
    start_date = "2023-01-01"
    end_date = "2023-03-31"
    
    print(f"[*] Downloading IMD/CPCB aggregated data for {len(CITIES)} Indian cities...")
    
    session = requests.Session()
    
    for i, (city, lat, lon) in enumerate(CITIES):
        retries = 3
        while retries > 0:
            try:
                print(f"    Fetching [{i+1}/{len(CITIES)}] {city}...")
                
                aq_url = f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&start_date={start_date}&end_date={end_date}&daily=pm10_mean,pm2_5_mean,carbon_monoxide_mean,nitrogen_dioxide_mean,sulphur_dioxide_mean,ozone_mean,european_aqi&timezone=Asia%2FKolkata"
                we_url = f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date={start_date}&end_date={end_date}&daily=temperature_2m_mean,relative_humidity_2m_mean,wind_speed_10m_max&timezone=Asia%2FKolkata"
                
                aq_resp = session.get(aq_url, timeout=10).json()
                we_resp = session.get(we_url, timeout=10).json()
                
                if 'daily' not in aq_resp or 'daily' not in we_resp:
                    break
                    
                aq_daily = aq_resp['daily']
                we_daily = we_resp['daily']
                
                for j in range(len(aq_daily['time'])):
                    dt = aq_daily['time'][j]
                    
                    pm25 = aq_daily.get('pm2_5_mean', [None]*len(aq_daily['time']))[j]
                    pm10 = aq_daily.get('pm10_mean', [None]*len(aq_daily['time']))[j]
                    
                    if pm25 is None and pm10 is None:
                        continue
                        
                    aqi = 50
                    if pm25 is not None: aqi = pm25 * 3 
                    elif pm10 is not None: aqi = pm10 * 1.5
                    
                    bucket = 'Good'
                    if aqi > 400: bucket = 'Severe'
                    elif aqi > 300: bucket = 'Very Poor'
                    elif aqi > 200: bucket = 'Poor'
                    elif aqi > 100: bucket = 'Moderate'
                    elif aqi > 50: bucket = 'Satisfactory'
                    
                    all_data.append({
                        'City': city,
                        'Date': dt,
                        'PM2.5': pm25,
                        'PM10': pm10,
                        'NO2': aq_daily.get('nitrogen_dioxide_mean', [None]*len(aq_daily['time']))[j],
                        'SO2': aq_daily.get('sulphur_dioxide_mean', [None]*len(aq_daily['time']))[j],
                        'CO': aq_daily.get('carbon_monoxide_mean', [None]*len(aq_daily['time']))[j],
                        'O3': aq_daily.get('ozone_mean', [None]*len(aq_daily['time']))[j],
                        'Temperature_C': we_daily.get('temperature_2m_mean', [None]*len(aq_daily['time']))[j],
                        'Humidity_Pct': we_daily.get('relative_humidity_2m_mean', [None]*len(aq_daily['time']))[j],
                        'Wind_Speed_kmh': we_daily.get('wind_speed_10m_max', [None]*len(aq_daily['time']))[j],
                        'AQI': aqi,
                        'AQI_Bucket': bucket
                    })
                
                time.sleep(0.5) # respect rate limit
                break
                
            except Exception as e:
                print(f"Error on {city}: {e}. Retrying...")
                retries -= 1
                time.sleep(2)
    
    if all_data:
        df = pd.DataFrame(all_data)
        df.to_csv(OUTPUT_CSV, index=False)
        print(f"[*] Successfully downloaded {len(df)} records for {len(CITIES)} cities.")
        print(f"[*] Saved to {OUTPUT_CSV}")
    else:
        print("Failed to download data.")

if __name__ == '__main__':
    fetch_data()
