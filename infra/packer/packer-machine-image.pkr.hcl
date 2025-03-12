packer {
  required_plugins {
    amazon-ebs = {
      source  = "github.com/hashicorp/amazon"
      version = ">= 1.0.0"
    }
    googlecompute = {
      source  = "github.com/hashicorp/googlecompute"
           version = ">= 1.0.0"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_source_ami" {
  type    = string
  default = "ami-0609a4e88e9e5a526" // Ubuntu 24.04 LTS
}

variable "instance_type" {
  type    = string
  default = "t2.micro"
}

variable "demo_account_id" {
  type        = string
  default     = ""
  description = "AWS account ID to share the AMI with"
}

variable "gcp_project_id" {
  type        = string
  default     = "dev-project-452007"
  description = "GCP DEV project ID"
}

variable "gcp_demo_project_id" {
  type        = string
  default     = ""
  description = "GCP DEMO project ID to share the image with"
}

variable "gcp_source_image" {
  type    = string
  default = "ubuntu-2404-noble-amd64-v20250214"
}

variable "gcp_zone" {
  type    = string
  default = "us-east1-b"
}

variable "gcp_machine_type" {
  type    = string
  default = "e2-medium"
}

variable "gcp_storage_location" {
  type    = string
  default = "us"
}

# AWS AMI Build
source "amazon-ebs" "ubuntu" {
  region                      = var.aws_region
  source_ami                  = var.aws_source_ami
  instance_type               = var.instance_type
  ssh_username                = "ubuntu"
  ami_name                    = "csye6225-nodejs-mysql-{{timestamp}}"
  ami_description             = "Custom image with Node.js binary and MySQL"
  associate_public_ip_address = true
  ssh_timeout                 = "10m"

  # Share AMI with the DEMO account
  ami_users = [var.demo_account_id]
}

# GCP Image Build
source "googlecompute" "ubuntu" {
  project_id           = var.gcp_project_id
  source_image         = var.gcp_source_image
  machine_type         = var.gcp_machine_type
  zone                 = var.gcp_zone
  image_name           = "csye6225-nodejs-mysql-{{timestamp}}"
  image_family         = "custom-images"
  image_description    = "Custom GCP image with Node.js and MySQL"
  ssh_username         = "ubuntu"
  wait_to_add_ssh_keys = "10s"
}

build {
  sources = [
    "source.amazon-ebs.ubuntu",
    "source.googlecompute.ubuntu" # Uncommented to build both AWS and GCP images
  ]

  provisioner "file" {
    source      = "dist/webapp"
    destination = "/tmp/webapp"
  }

  provisioner "file" {
    source      = "setup.sh"
    destination = "/tmp/setup.sh"
  }

  provisioner "file" {
    source      = "webapp.service"
    destination = "/tmp/webapp.service"
  }

  provisioner "shell" {
    inline = [
      "chmod +x /tmp/setup.sh",
      "sudo /tmp/setup.sh"
    ]
  }
}