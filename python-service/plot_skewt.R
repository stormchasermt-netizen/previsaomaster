args <- commandArgs(trailingOnly = TRUE)
if(length(args) < 3) {
  stop("Usage: Rscript plot_skewt.R <csv_file> <output_png> <title>")
}

csv_file <- args[1]
output_png <- args[2]
plot_title <- args[3]

library("thundeR")

# Read CSV
data <- read.csv(csv_file)

# Generate Skew-T plot
sounding_save(
  filename = output_png,
  title = plot_title,
  pressure = data$pres,
  altitude = data$hght,
  temp = data$tmpc,
  dpt = data$dwpc,
  wd = data$wdir,
  ws = data$wspd,
  accuracy = 2
)
